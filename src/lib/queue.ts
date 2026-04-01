import { Queue } from 'bullmq'
import Redis from 'ioredis'

export const PRICE_QUEUE_NAME = 'price-updates'
export const IMPORT_QUEUE_NAME = 'import-transactions'

const redisConnectionOptions = {
  host: '172.17.0.1',
  port: 6379,
  password: '2002Stefano',
  maxRetriesPerRequest: null,
}
let priceQueue: Queue | null = null
let importQueue: Queue | null = null

export function getPriceQueue(): Queue {
  if (!priceQueue) {
    priceQueue = new Queue(PRICE_QUEUE_NAME, {
      connection: new Redis(redisConnectionOptions)
    })
  }
  return priceQueue
}

export function getImportQueue(): Queue {
  if (!importQueue) {
    importQueue = new Queue(IMPORT_QUEUE_NAME, {
     connection: new Redis(redisConnectionOptions)
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
    removeOnComplete: true,
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
