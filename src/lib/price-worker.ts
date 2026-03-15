import { Worker } from 'bullmq'
import redisClient from './redis'
import { PRICE_QUEUE_NAME } from './queue'
import { normalizeTickerForYahoo } from './portfolio-engine'

const PRICE_CACHE_PREFIX = 'stock-price:'
const PRICE_CACHE_TTL = 3600 // 1 hour

export const priceWorker = new Worker(
  PRICE_QUEUE_NAME,
  async (job) => {
    const { tickers } = job.data as { tickers: string[] }
    console.log(`[Worker] Updating prices for: ${tickers.join(', ')}`)

    if (!tickers.length) return

    try {
      const yahooModule = await import('yahoo-finance2')
      const YahooFinance = (yahooModule as any).default || yahooModule
      const yahooFinance = typeof YahooFinance === 'function' ? new YahooFinance() : YahooFinance

      // Set a real browser User-Agent to avoid 429s
      if (typeof (yahooFinance as any).setGlobalConfig === 'function') {
        (yahooFinance as any).setGlobalConfig({
          fetchOptions: {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
          }
        })
      }

      // Map our tickers to Yahoo symbols
      const symbolToTicker = new Map<string, string>()
      const symbols = tickers.map(ticker => {
        const symbol = normalizeTickerForYahoo(ticker)
        symbolToTicker.set(symbol, ticker)
        return symbol
      })

      // Fetch ALL at once
      const quotes: any[] = await (yahooFinance as any).quote(symbols, {}, { return: 'array' })

      for (const quote of quotes) {
        if (quote?.regularMarketPrice) {
          const ticker = symbolToTicker.get(quote.symbol)
          if (ticker) {
            const price = quote.regularMarketPrice
            // Update Redis
            await redisClient.setex(`${PRICE_CACHE_PREFIX}${ticker}`, PRICE_CACHE_TTL, price.toString())
            console.log(`[Worker] Updated ${ticker}: ${price}`)
          }
        }
      }
    } catch (err) {
      console.error('[Worker] Fatal error:', err)
    }
  },
  {
    connection: redisClient.options,
    concurrency: 5,
  }
)

priceWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed`)
})

priceWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed with ${err.message}`)
})

console.log('[Worker] Price update worker started')
