import { Worker, Job } from 'bullmq'
import { IMPORT_QUEUE_NAME } from './queue'
import { getRedis, getRedisConnectionOpts } from './redis'
import { createServiceClient } from './supabase-server'
import { processTransactionBatch } from './portfolio-engine'
import { invalidateUserCache } from './redis'
import { fetchQuotesWithFallback } from './yahoo-finance'

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
      // 1. Set lock to block price-worker and manual transactions
      if (redis) await redis.setex(`importing:${userId}`, 3600, '1')
      await job.updateProgress({ percentage: 5, message: 'Initializing import...' })

      // 2. Process the batch with progress tracking (replace handled inside)
      const results = await processTransactionBatch(
        supabase,
        userId, 
        transactions,
        replace, // Pass replace flag here
        async (percentage: number, message: string) => {
          // Map processTransactionBatch progress (10-95) to job progress (15-90)
          const jobPercentage = 15 + Math.floor((percentage / 100) * 75)
          await job.updateProgress({ percentage: jobPercentage, message })
        }
      )

      await job.updateProgress({ percentage: 92, message: 'Invalidating cache...' })

      // 4. Invalidate cache
      if (results.imported > 0) {
        await invalidateUserCache(userId)
      }

      await job.updateProgress({ percentage: 95, message: 'Fetching prices for new tickers...' })

      // 5. Fetch prices for any new tickers
      if (results.imported > 0) {
        const uniqueTickers = Array.from(new Set(transactions.map(t => t.ticker).filter(Boolean)))
        const tickers = uniqueTickers
        if (tickers.length > 0) {
          try {
            console.log(`[ImportWorker] Fetching prices for ${tickers.length} new ticker(s):`, tickers)
            await fetchQuotesWithFallback(tickers)
            console.log(`[ImportWorker] Fetched prices for ${tickers.length} ticker(s)`)
            
            // CRITICAL: Add delay to ensure prices are cached before frontend reloads
            await new Promise(resolve => setTimeout(resolve, 2000))
            console.log(`[ImportWorker] 2-second delay after price fetch completed`)
          } catch (priceErr) {
            console.warn(`[ImportWorker] Failed to fetch prices for new tickers:`, priceErr)
            // Non-critical error - continue
          }
        }
      }

      await job.updateProgress({ percentage: 100, message: 'Import completed!' })

      console.log(`[ImportWorker] Job ${job.id} completed. Success: ${results.success}, Imported: ${results.imported}, Failed: ${results.failed}`)

      // Return detailed results
      return {
        success: results.success,
        imported: results.imported,
        failed: results.failed,
        errors: results.errors,
        message: results.success 
          ? `Successfully imported ${results.imported} transaction(s)` 
          : `Import failed. ${results.failed} transaction(s) had errors. Batch rolled back.`
      }

    } catch (err) {
      console.error(`[ImportWorker] Job ${job.id} failed:`, err)
      
      // Return structured error
      return {
        success: false,
        imported: 0,
        failed: transactions.length,
        errors: [{ 
          line: 0, 
          ticker: 'UNKNOWN', 
          error: err instanceof Error ? err.message : 'Unknown error' 
        }],
        message: 'Import failed with unexpected error'
      }
    } finally {
      // 5. Always release lock
      if (redis) await redis.del(`importing:${userId}`)
    }
  },
  {
    ...getRedisConnectionOpts(),
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
