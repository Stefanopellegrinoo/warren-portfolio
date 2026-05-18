import { Queue } from 'bullmq'
import Redis from 'ioredis'

export const PRICE_QUEUE_NAME = 'price-updates'
export const IMPORT_QUEUE_NAME = 'import-transactions'

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
  const queue = getPriceQueue()
  await queue.add('update-prices', { tickers }, {
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })
}

export async function addImportJob(userId: string, transactions: any[], replace: boolean) {
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

  // Remove existing repeatable jobs to avoid duplicates
  const repeatable = await queue.getRepeatableJobs()
  for (const job of repeatable) {
    await queue.removeRepeatableByKey(job.key)
  }

  // Add new repeatable job
  await queue.add('update-all-prices', {}, {
    repeat: {
      every: intervalMinutes * 60 * 1000, // ms
    },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })

  console.log(`[Queue] Repeatable price job scheduled every ${intervalMinutes} min`)
}
