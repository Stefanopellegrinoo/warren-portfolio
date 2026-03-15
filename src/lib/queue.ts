import { Queue } from 'bullmq'
import redisClient from './redis'

export const PRICE_QUEUE_NAME = 'price-updates'

export const priceQueue = new Queue(PRICE_QUEUE_NAME, {
  connection: redisClient.options,
})

export async function addPriceUpdateJob(tickers: string[]) {
  // Join tickers to create a unique job ID for debouncing if needed, 
  // or just add them to the queue.
  await priceQueue.add('update-prices', { tickers }, {
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 }, // Keep failed for a day
  })
}
