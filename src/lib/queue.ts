import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { ensureRedisConnected } from './redis'

/**
 * Thrown when an enqueue is REQUIRED (imports) and Redis is unreachable.
 * BullMQ's queue.add() hangs on ioredis's offline queue when Redis is down
 * (maxRetriesPerRequest: null) — it never settles, so try/catch around the
 * call is useless. Every enqueue path probes connectivity first.
 */
export class QueueUnavailableError extends Error {
  constructor() {
    super('La cola de trabajos no está disponible (Redis inaccesible). Reintentá en unos minutos.')
    this.name = 'QueueUnavailableError'
  }
}

export const PRICE_QUEUE_NAME = 'price-updates'
export const IMPORT_QUEUE_NAME = 'import-transactions'

/** Repeatable job names on the price queue — both live here so the schedulers
 *  can clean up their own key without clobbering the other's. */
export const PRICE_REPEAT_JOB_NAME = 'update-all-prices'
/** Nightly ON close capture. The string is the key of the schedule already
 *  stored in Redis (the job used to snapshot portfolios too); keeping it lets
 *  the scheduler replace that schedule instead of orphaning it. */
export const NIGHTLY_JOB_NAME = 'daily-snapshot'
export const TICKER_AUDIT_JOB_NAME = 'ticker-audit'
export const ON_TERMS_JOB_NAME = 'on-terms-ingest'
export const FX_RATES_JOB_NAME = 'fx-rates-ingest'
export const SPLITS_INGEST_JOB_NAME = 'splits-ingest'
export const ON_PRICES_PERSIST_JOB_NAME = 'on-prices-persist'

/**
 * Parse Redis connection URL from REDIS_URL env var
 * Supports formats:
 * - redis://localhost:6379
 * - redis://:password@localhost:6379
 * - redis://user:password@localhost:6379
 */
function parseRedisUrl(url: string) {
  if (!url) throw new Error('REDIS_URL is not defined')
  const parsed = new URL(url.startsWith('redis://') ? url : `redis://${url}`)
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6380', 10),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    maxRetriesPerRequest: null,
  }
}

let priceQueue: Queue | null = null
let importQueue: Queue | null = null

export function getPriceQueue(): Queue {
  if (!priceQueue) {
    priceQueue = new Queue(PRICE_QUEUE_NAME, {
      connection: new Redis(parseRedisUrl(process.env.REDIS_URL || ''))
    })
  }
  return priceQueue
}

export function getImportQueue(): Queue {
  if (!importQueue) {
    importQueue = new Queue(IMPORT_QUEUE_NAME, {
      connection: new Redis(parseRedisUrl(process.env.REDIS_URL || ''))
    })
  }
  return importQueue
}

export async function addPriceUpdateJob(tickers: string[]) {
  // Best-effort job: with Redis down, skipping beats hanging the request.
  if (!(await ensureRedisConnected())) {
    console.warn('[Queue] Redis unreachable — skipping price update job')
    return
  }
  const queue = getPriceQueue()
  await queue.add('update-prices', { tickers }, {
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })
}

export async function addRefreshSummaryJob(userId: string) {
  // Best-effort job: with Redis down, skipping beats hanging the request.
  if (!(await ensureRedisConnected())) {
    console.warn('[Queue] Redis unreachable — skipping summary refresh job')
    return
  }
  const queue = getPriceQueue()
  await queue.add('refresh-summary', { userId }, {
    // No ':' — BullMQ uses it as its Redis key separator and rejects custom ids
    // containing one ("Custom Id cannot contain :"). Every caller wraps this in
    // try/catch, so a ':' here fails silently forever.
    jobId: `refresh-summary-${userId}`,
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })
}

export async function addImportJob(userId: string, transactions: any[], replace: boolean) {
  // Imports NEED the queue — fail loudly instead of hanging the request.
  if (!(await ensureRedisConnected())) {
    throw new QueueUnavailableError()
  }
  const queue = getImportQueue()
  return await queue.add('process-import', { userId, transactions, replace }, {
    removeOnComplete: { age: 30, count: 10 }, // Keep for 30 seconds or last 10 jobs
    removeOnFail: { age: 24 * 3600 },
  })
}

/**
 * Schedule a repeatable job that fetches all prices every N minutes.
 * Call this once when the worker starts.
 */
export async function scheduleRepeatingPriceJob(intervalMinutes = 5) {
  const queue = getPriceQueue()

  // Drop only THIS job's previous schedule. Wiping every repeatable on the queue
  // would also delete the nightly job, which shares this queue.
  const repeatable = await queue.getRepeatableJobs()
  for (const job of repeatable) {
    if (job.name === PRICE_REPEAT_JOB_NAME) {
      await queue.removeRepeatableByKey(job.key)
    }
  }

  // Add new repeatable job
  await queue.add(PRICE_REPEAT_JOB_NAME, {}, {
    repeat: {
      every: intervalMinutes * 60 * 1000, // ms
    },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })

  console.log(`[Queue] Repeatable price job scheduled every ${intervalMinutes} min`)
}

/**
 * Schedule the nightly ON close capture at 02:00 UTC Tue–Sat, which is 23:00
 * Mon–Fri in Argentina, after the local market closed.
 *
 * Containers run without a TZ set, so cron patterns here are UTC — same
 * convention as the signals queue. The date stamped on the rows comes from
 * argentinaDate(), NOT from the UTC clock.
 */
export async function scheduleNightlyJob(pattern = '0 2 * * 2-6') {
  const queue = getPriceQueue()

  const repeatable = await queue.getRepeatableJobs()
  for (const job of repeatable) {
    if (job.name === NIGHTLY_JOB_NAME) {
      await queue.removeRepeatableByKey(job.key)
    }
  }

  await queue.add(NIGHTLY_JOB_NAME, {}, {
    repeat: { pattern },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })

  console.log(`[Queue] Nightly ON price capture scheduled (${pattern} UTC)`)
}

/**
 * Schedule the weekly ticker identity audit (Saturdays 03:00 UTC).
 *
 * Weekly, not daily: an instrument's identity changes with corporate actions,
 * and re-resolving every held ticker daily buys nothing but Yahoo calls.
 */
export async function scheduleTickerAuditJob(pattern = '0 3 * * 6') {
  const queue = getPriceQueue()

  // Remove only THIS job's schedule. The price and nightly jobs share this
  // queue, and a blanket removeRepeatableByKey would silently delete theirs.
  const repeatable = await queue.getRepeatableJobs()
  for (const job of repeatable) {
    if (job.name === TICKER_AUDIT_JOB_NAME) {
      await queue.removeRepeatableByKey(job.key)
    }
  }

  await queue.add(TICKER_AUDIT_JOB_NAME, {}, {
    repeat: { pattern },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })

  console.log(`[Queue] Weekly ticker identity audit scheduled (${pattern} UTC)`)
}

/**
 * Schedule the nightly ON terms ingest (weekdays 23:30 UTC = 20:30 ART). BYMA Educa
 * still served the previous day at 21:30 UTC on 2026-10-21, so run after it publishes.
 * Removes every previous on-terms-ingest repeatable (any cron) before adding.
 */
export async function scheduleOnTermsIngestJob(pattern = '30 23 * * 1-5') {
  const queue = getPriceQueue()

  const repeatable = await queue.getRepeatableJobs()
  for (const job of repeatable) {
    if (job.name === ON_TERMS_JOB_NAME) {
      await queue.removeRepeatableByKey(job.key)
    }
  }

  await queue.add(ON_TERMS_JOB_NAME, {}, {
    repeat: { pattern },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })

  console.log(`[Queue] ON terms ingest scheduled (${pattern} UTC)`)
}

/**
 * Schedule the daily write of the ON prices to the database at 21:15 UTC Mon–Fri
 * (18:15 in Argentina, after BYMA closes). All day they live in Redis; the database
 * copy is only their last-resort fallback, so once a day is enough.
 */
export async function scheduleOnPricesPersistJob(pattern = '15 21 * * 1-5') {
  const queue = getPriceQueue()

  const repeatable = await queue.getRepeatableJobs()
  for (const job of repeatable) {
    if (job.name === ON_PRICES_PERSIST_JOB_NAME) {
      await queue.removeRepeatableByKey(job.key)
    }
  }

  await queue.add(ON_PRICES_PERSIST_JOB_NAME, {}, {
    repeat: { pattern },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })

  console.log(`[Queue] Daily ON price write scheduled (${pattern} UTC)`)
}

/**
 * Schedule the nightly MEP/CCL history ingest at 23:45 UTC Mon–Fri (20:45 in
 * Argentina, after the close is published).
 */
export async function scheduleFxRatesIngestJob(pattern = '45 23 * * 1-5') {
  const queue = getPriceQueue()

  const repeatable = await queue.getRepeatableJobs()
  for (const job of repeatable) {
    if (job.name === FX_RATES_JOB_NAME) {
      await queue.removeRepeatableByKey(job.key)
    }
  }

  await queue.add(FX_RATES_JOB_NAME, {}, {
    repeat: { pattern },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })

  // Once now as well: a fresh deploy (or an empty table) gets the history
  // without waiting for the night. The ingest writes only new or changed days,
  // so on a full table this run writes nothing.
  await queue.add(FX_RATES_JOB_NAME, {}, { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } })

  console.log(`[Queue] FX rates ingest scheduled (${pattern} UTC) and queued once now`)
}

/**
 * Schedule the stock splits ingest (odd/tasks/split-aware-ledger.md T2) at 12:30 and 20:30 UTC
 * Mon–Fri: before the US open, so a split dated today is stored before its first post-split
 * quote, and after the close. Queued once now as well, so a deploy fills an empty table.
 */
export async function scheduleSplitsIngestJob(pattern = '30 12,20 * * 1-5') {
  const queue = getPriceQueue()

  const repeatable = await queue.getRepeatableJobs()
  for (const job of repeatable) {
    if (job.name === SPLITS_INGEST_JOB_NAME) {
      await queue.removeRepeatableByKey(job.key)
    }
  }

  await queue.add(SPLITS_INGEST_JOB_NAME, {}, {
    repeat: { pattern },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })
  await queue.add(SPLITS_INGEST_JOB_NAME, {}, { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } })

  console.log(`[Queue] Stock splits ingest scheduled (${pattern} UTC) and queued once now`)
}
