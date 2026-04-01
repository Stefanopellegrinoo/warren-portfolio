import { Worker, Job } from 'bullmq'
import { IMPORT_QUEUE_NAME } from './queue'
import { getRedis } from './redis'
import { createServiceClient } from './supabase-server'
import { processTransactionBatch } from './portfolio-engine'
import { invalidateUserCache } from './redis'

const REDIS_URL = process.env.REDIS_URL || 'redis://:2002Stefano@172.17.0.1:6379'

export const importWorker = new Worker(
  IMPORT_QUEUE_NAME,
  async (job: Job) => {
    const { userId, transactions, replace } = job.data as {
      userId: string
      transactions: any[]
      replace: boolean
    }

    console.log(`[ImportWorker] Starting job ${job.id} for user ${userId} (${transactions.length} txs)`)
    const redis = getRedis()
    const supabase = createServiceClient()

    try {
      // 1. Set lock to block price-worker
      if (redis) await redis.setex(`importing:${userId}`, 300, '1')
      await job.updateProgress(10)

      // 2. Handle replacement if requested
      if (replace) {
        console.log(`[ImportWorker] Replacing all data for user ${userId}`)
        await supabase.from('transactions').delete().eq('user_id', userId)
        await supabase.from('positions').delete().eq('user_id', userId)
        await supabase.from('closed_trades').delete().eq('user_id', userId)
      }
      await job.updateProgress(20)

      // 3. Process the batch (bulk insert + rebuild tickers)
      // Note: we can chunk this if the array is massive, but for now we do it in one go
      const results = await processTransactionBatch(userId, transactions)
      await job.updateProgress(90)

      // 4. Invalidate cache
      if (results.imported > 0) {
        await invalidateUserCache(userId)
      }

      console.log(`[ImportWorker] Job ${job.id} completed. Imported: ${results.imported}, Errors: ${results.errors}`)
      await job.updateProgress(100)

      return results

    } catch (err) {
      console.error(`[ImportWorker] Job ${job.id} failed:`, err)
      throw err
    } finally {
      // 5. Always release lock
      if (redis) await redis.del(`importing:${userId}`)
    }
  },
  {
    connection: { url: REDIS_URL },
    concurrency: 1, // One import at a time globally to avoid DB/Redis thrashing, or we could increase it
  }
)

importWorker.on('completed', (job) => {
  console.log(`[ImportWorker] Job ${job.id} completed successfully`)
})

importWorker.on('failed', (job, err) => {
  console.error(`[ImportWorker] Job ${job?.id} failed with error: ${err.message}`)
})

export function startImportWorker() {
  console.log('[ImportWorker] Import background worker initialized')
}
