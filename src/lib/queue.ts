import { Queue } from 'bullmq'

export const PRICE_QUEUE_NAME = 'price-updates'

let priceQueue: Queue | null = null

export function getPriceQueue(): Queue {
  if (!priceQueue) {
    priceQueue = new Queue(PRICE_QUEUE_NAME, {
      connection: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      },
    })
  }
  return priceQueue
}

export async function addPriceUpdateJob(tickers: string[]) {
  const queue = getPriceQueue()
  await queue.add('update-prices', { tickers }, {
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })
}

/**
 * Schedule a repeatable job that fetches all prices every N minutes.
 * Call this once when the worker starts.
 */
export async function scheduleRepeatingPriceJob(intervalMinutes = 2) {
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
