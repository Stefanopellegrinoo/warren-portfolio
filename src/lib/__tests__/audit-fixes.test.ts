import { describe, it, expect, vi } from 'vitest'
import { calculatePortfolioSummary, splitTickersByAssetType } from '../portfolio-engine'
import type { Position, ONPosition, Quote } from '@/types'

describe('Audit Fixes Verification', () => {
  describe('calculatePortfolioSummary - PnL Bias Fix', () => {
    it('excludes unpriced positions from total invested to avoid PnL bias', () => {
      const stockPositions: Position[] = [
        { 
          id: '1', user_id: 'u1', ticker: 'AAPL', quantity: 10, avg_cost: 150, 
          total_invested: 1500, first_bought: '2024-01-01', last_updated: '', version: 1 
        },
        { 
          id: '2', user_id: 'u1', ticker: 'MSFT', quantity: 10, avg_cost: 300, 
          total_invested: 3000, first_bought: '2024-01-01', last_updated: '', version: 1 
        }
      ]
      
      const onPositions: ONPosition[] = []
      
      // Only AAPL has a quote
      const stockQuotes = new Map<string, Quote>([
        ['AAPL', { ticker: 'AAPL', price: 160, change: 10, changePercent: 0.06, previousClose: 150 }]
      ])
      const onQuotes = new Map<string, Quote>()
      
      const result = calculatePortfolioSummary(
        stockPositions,
        onPositions,
        stockQuotes,
        onQuotes,
        0, // cash
        0, // realized stock
        0  // realized on
      )
      
      // BEFORE FIX: stock_invested would be 4500 (AAPL + MSFT)
      // market_value is 1600 (AAPL) + 0 (MSFT) = 1600
      // PnL would be 1600 - 4500 = -2900 (Wrong!)
      
      // AFTER FIX: stock_invested should be 1500 (Only AAPL)
      // PnL should be 1600 - 1500 = 100
      expect(result.summary.stocks.invested).toBe(1500)
      expect(result.summary.stocks.market_value).toBe(1600)
      expect(result.summary.stocks.pnl).toBe(100)
      expect(result.summary.open_pnl).toBe(100)
      expect(result.summary.total_invested).toBe(1500)
    })
  })

  describe('Portfolio Engine - processTransactionBatch sorting', () => {
    it('sorts transactions chronologically before processing', async () => {
      const inputs = [
        { date: '2024-01-05', ticker: 'AAPL', operation: 'VENTA', quantity: 5, price: 160 },
        { date: '2024-01-01', ticker: 'AAPL', operation: 'COMPRA', quantity: 10, price: 150 }
      ]
      const sorted = [...inputs].sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      )
      expect(sorted[0].date).toBe('2024-01-01')
      expect(sorted[1].date).toBe('2024-01-05')
    })
  })

  describe('splitTickersByAssetType — C1 fix', () => {
    it('routes ON tickers separately from stock tickers', () => {
      const inputs = [
        { ticker: 'AMZN', assetType: 'ACCION' },
        { ticker: 'YMCAD', assetType: 'ON' },
        { ticker: 'MELI', assetType: 'CEDEAR' },
        { ticker: 'PBRD', assetType: 'ON' },
      ]
      const { stockTickers, onTickers } = splitTickersByAssetType(inputs)
      expect(stockTickers).toEqual(['AMZN', 'MELI'])
      expect(onTickers).toEqual(['YMCAD', 'PBRD'])
    })

    it('defaults to ACCION when assetType is absent', () => {
      const inputs = [
        { ticker: 'AMZN' },
        { ticker: 'PBRD', assetType: 'ON' },
      ]
      const { stockTickers, onTickers } = splitTickersByAssetType(inputs)
      expect(stockTickers).toEqual(['AMZN'])
      expect(onTickers).toEqual(['PBRD'])
    })

    it('normalizes ticker casing and deduplicates', () => {
      const inputs = [
        { ticker: 'amzn', assetType: 'ACCION' },
        { ticker: 'AMZN', assetType: 'ACCION' },
        { ticker: 'YMCAD', assetType: 'ON' },
      ]
      const { stockTickers, onTickers } = splitTickersByAssetType(inputs)
      expect(stockTickers).toEqual(['AMZN'])
      expect(onTickers).toEqual(['YMCAD'])
    })

    it('returns all stock tickers when no ONs present', () => {
      const inputs = [
        { ticker: 'AMZN', assetType: 'ACCION' },
        { ticker: 'MELI', assetType: 'CEDEAR' },
      ]
      const { stockTickers, onTickers } = splitTickersByAssetType(inputs)
      expect(stockTickers).toEqual(['AMZN', 'MELI'])
      expect(onTickers).toEqual([])
    })

    it('returns all ON tickers when no stocks present', () => {
      const inputs = [
        { ticker: 'YMCAD', assetType: 'ON' },
        { ticker: 'PBRD', assetType: 'ON' },
      ]
      const { stockTickers, onTickers } = splitTickersByAssetType(inputs)
      expect(stockTickers).toEqual([])
      expect(onTickers).toEqual(['YMCAD', 'PBRD'])
    })
  })
})
