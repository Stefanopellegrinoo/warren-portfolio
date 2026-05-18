import { Worker, type Job } from 'bullmq'
import type { Candle } from '@/lib/binance/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-server'
import { getRedis, getRedisConnectionOpts } from '@/lib/redis'
import { fetchKlines } from '@/lib/yahoo-finance'
import { isMarketOpen } from '@/lib/utils'
import { SIGNALS_QUEUE_NAME } from '@/lib/signals-queue'
import {
  ema,
  rsi,
  macd,
  bollinger,
  volumeAvg,
  evaluateConditions,
  type ComputedState,
} from '@/lib/indicators'
import type { IndicatorSetup } from '@/types'

type CloseReason = 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT'

interface StrategyRef {
  id: string
  tickers: string[] | null
  timeframes: string[] | null
}

type SetupWithStrategy = IndicatorSetup & { strategies: StrategyRef | null }

interface PaperTradeRow {
  id: string
  setup_id: string
  strategy_id: string
  user_id: string
  ticker: string
  open_signal_id: string | null
  open_price: number
  open_at: string
  status: 'OPEN' | 'CLOSED'
}

interface SetupPerformanceRow {
  setup_id: string
  ticker: string
  total_trades: number
  profitable_trades: number
  hit_rate: number
  avg_return_pct: number | null
  avg_duration_days: number | null
}

const KLINES_LOOKBACK_DAYS = 365
const MIN_KLINES = 30

export function startSignalsWorker() {
  const worker = new Worker(SIGNALS_QUEUE_NAME, handleSignalsJob, {
    ...getRedisConnectionOpts(),
    concurrency: 1,
  })

  worker.on('failed', (job, err) =>
    console.error('[signals-worker] job failed', job?.id, err.message)
  )

  console.log('[signals-worker] started')
  return worker
}

async function handleSignalsJob(job: Job): Promise<void> {
  const { userId, ticker } = (job.data ?? {}) as { userId?: string; ticker?: string }

  if (!isMarketOpen()) {
    console.log('[signals-worker] market closed, skipping evaluation')
    return
  }

  const supabase = createServiceClient()

  let query = supabase
    .from('indicator_setups')
    .select('*, strategies!inner(id, tickers, timeframes)')
    .eq('active', true)

  if (userId) query = query.eq('user_id', userId)

  const { data: setups, error } = await query
  if (error) {
    console.error('[signals-worker] error fetching setups', error.message)
    return
  }
  if (!setups?.length) return

  for (const setup of setups as SetupWithStrategy[]) {
    const strategyTickers: string[] = ticker
      ? [ticker]
      : setup.strategies?.tickers ?? []

    for (const t of strategyTickers) {
      await evaluateSetupForTicker(supabase, setup, t).catch((err: Error) =>
        console.error(
          `[signals-worker] error evaluating ${setup.id} / ${t}:`,
          err.message
        )
      )
    }
  }
}

async function evaluateSetupForTicker(
  supabase: SupabaseClient,
  setup: SetupWithStrategy,
  ticker: string
): Promise<void> {
  const period2 = new Date()
  const period1 = new Date(period2.getTime() - KLINES_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const klines = await fetchKlines(ticker, '1d', period1, period2)
  if (!klines || klines.length < MIN_KLINES) {
    console.log(`[signals-worker] insufficient klines for ${ticker}`)
    return
  }

  const candles: Candle[] = klines.map((k) => ({
    time: Math.floor(new Date(k.date + 'T00:00:00Z').getTime() / 1000),
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
  }))

  const state: ComputedState = {
    candles,
    ema: {},
    rsi: {},
    macd: [],
    bollinger: [],
    volumeAvg: {},
  }

  for (const ind of setup.config.indicators) {
    switch (ind.type) {
      case 'EMA': {
        const period = ind.period ?? 20
        state.ema[period] = ema(candles, period)
        break
      }
      case 'RSI': {
        const period = ind.period ?? 14
        state.rsi[period] = rsi(candles, period)
        break
      }
      case 'MACD': {
        state.macd = macd(candles, ind.fast ?? 12, ind.slow ?? 26, ind.signal ?? 9)
        break
      }
      case 'Bollinger': {
        state.bollinger = bollinger(candles, ind.period ?? 20, ind.stdDev ?? 2)
        break
      }
      case 'Volume': {
        const period = ind.period ?? 20
        state.volumeAvg[period] = volumeAvg(candles, period)
        break
      }
    }
  }

  const isBuy = evaluateConditions(setup.config.conditions.buy, state)
  const isSell = evaluateConditions(setup.config.conditions.sell, state)

  const lastCandle = candles[candles.length - 1]
  const currentPrice = (await getCurrentPrice(ticker)) ?? lastCandle.close

  await checkExitConditions(supabase, setup, ticker, currentPrice)

  if (isBuy && isSell) {
    console.warn(`[signals-worker] BUY y SELL ambos activos para ${ticker} en setup ${setup.id} — priorizando SELL`)
  }
  if (isSell) {
    await handleSellSignal(supabase, setup, ticker, currentPrice, state)
  } else if (isBuy) {
    await handleBuySignal(supabase, setup, ticker, currentPrice, state)
  }
}

async function getCurrentPrice(ticker: string): Promise<number | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`price:${ticker}`)
    if (!raw) {
      console.warn(`[signals-worker] no cached price for ${ticker}, falling back to last candle close`)
      return null
    }
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'number') return parsed
    if (parsed && typeof parsed.price === 'number') return parsed.price
    return null
  } catch {
    return null
  }
}

async function handleBuySignal(
  supabase: SupabaseClient,
  setup: SetupWithStrategy,
  ticker: string,
  price: number,
  state: ComputedState
): Promise<void> {
  const { data: existing } = await supabase
    .from('paper_trades')
    .select('id')
    .eq('setup_id', setup.id)
    .eq('ticker', ticker)
    .eq('status', 'OPEN')
    .maybeSingle()

  if (existing) return

  const firedAt = new Date().toISOString()

  const { data: signal, error } = await supabase
    .from('signals')
    .insert({
      setup_id: setup.id,
      strategy_id: setup.strategy_id,
      user_id: setup.user_id,
      ticker,
      type: 'BUY',
      price,
      timeframe: '1d',
      fired_at: firedAt,
      metadata: buildMetadata(state),
    })
    .select('id')
    .single()

  if (error || !signal) {
    console.error('[signals-worker] error inserting BUY signal', error?.message)
    return
  }

  const { error: tradeError } = await supabase.from('paper_trades').insert({
    setup_id: setup.id,
    strategy_id: setup.strategy_id,
    user_id: setup.user_id,
    ticker,
    open_signal_id: signal.id,
    open_price: price,
    open_at: firedAt,
    status: 'OPEN',
  })

  if (tradeError) {
    console.error('[signals-worker] error inserting paper_trade', tradeError.message)
    return
  }

  console.log(
    `[signals-worker] BUY signal fired: ${ticker} @ ${price} (setup: ${setup.name})`
  )
}

async function handleSellSignal(
  supabase: SupabaseClient,
  setup: SetupWithStrategy,
  ticker: string,
  price: number,
  state: ComputedState
): Promise<void> {
  await closeTrade(supabase, setup, ticker, price, 'SIGNAL', state)
}

async function checkExitConditions(
  supabase: SupabaseClient,
  setup: SetupWithStrategy,
  ticker: string,
  price: number
): Promise<void> {
  const { data: trade } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('setup_id', setup.id)
    .eq('ticker', ticker)
    .eq('status', 'OPEN')
    .maybeSingle()

  if (!trade) return

  const tradeRow = trade as PaperTradeRow
  const sl = setup.config.stopLoss
  const tp = setup.config.takeProfit

  if (sl && price < tradeRow.open_price * (1 - sl)) {
    await closeTrade(supabase, setup, ticker, price, 'STOP_LOSS', null, tradeRow)
  } else if (tp && price > tradeRow.open_price * (1 + tp)) {
    await closeTrade(supabase, setup, ticker, price, 'TAKE_PROFIT', null, tradeRow)
  }
}

async function closeTrade(
  supabase: SupabaseClient,
  setup: SetupWithStrategy,
  ticker: string,
  price: number,
  reason: CloseReason,
  state: ComputedState | null,
  existingTrade?: PaperTradeRow
): Promise<void> {
  let trade: PaperTradeRow | null = existingTrade ?? null

  if (!trade) {
    const { data } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('setup_id', setup.id)
      .eq('ticker', ticker)
      .eq('status', 'OPEN')
      .maybeSingle()
    trade = (data as PaperTradeRow | null) ?? null
  }

  if (!trade) return

  let closeSignalId: string | null = null
  if (reason === 'SIGNAL' && state) {
    const { data: sig, error } = await supabase
      .from('signals')
      .insert({
        setup_id: setup.id,
        strategy_id: setup.strategy_id,
        user_id: setup.user_id,
        ticker,
        type: 'SELL',
        price,
        timeframe: '1d',
        fired_at: new Date().toISOString(),
        metadata: buildMetadata(state),
      })
      .select('id')
      .single()

    if (error) {
      console.error('[signals-worker] error inserting SELL signal', error.message)
    }
    closeSignalId = sig?.id ?? null
  }

  const pnl_pct = ((price - trade.open_price) / trade.open_price) * 100
  const close_at = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('paper_trades')
    .update({
      close_price: price,
      close_at,
      close_reason: reason,
      close_signal_id: closeSignalId,
      pnl_pct,
      status: 'CLOSED',
    })
    .eq('id', trade.id)
    .eq('status', 'OPEN')

  if (updateError) {
    console.error('[signals-worker] error closing paper_trade', updateError.message)
    return
  }

  console.log(
    `[signals-worker] trade closed: ${ticker} @ ${price} (${reason}, pnl: ${pnl_pct.toFixed(2)}%)`
  )

  await updateSetupPerformance(
    supabase,
    setup,
    ticker,
    pnl_pct,
    trade.open_at,
    close_at
  ).catch((err: Error) =>
    console.error('[signals-worker] error updating setup_performance', err.message)
  )
}

async function updateSetupPerformance(
  supabase: SupabaseClient,
  setup: SetupWithStrategy,
  ticker: string,
  pnl_pct: number,
  open_at: string,
  close_at: string
): Promise<void> {
  const { data: current } = await supabase
    .from('setup_performance')
    .select('*')
    .eq('setup_id', setup.id)
    .eq('ticker', ticker)
    .maybeSingle()

  const durationDays =
    (new Date(close_at).getTime() - new Date(open_at).getTime()) /
    (1000 * 60 * 60 * 24)
  const isProfitable = pnl_pct > 0

  if (!current) {
    await supabase.from('setup_performance').insert({
      setup_id: setup.id,
      strategy_id: setup.strategy_id,
      user_id: setup.user_id,
      ticker,
      total_trades: 1,
      profitable_trades: isProfitable ? 1 : 0,
      hit_rate: isProfitable ? 1 : 0,
      avg_return_pct: pnl_pct,
      avg_duration_days: durationDays,
      updated_at: new Date().toISOString(),
    })
    return
  }

  const previous = current as SetupPerformanceRow
  const n = previous.total_trades + 1
  const profitable = previous.profitable_trades + (isProfitable ? 1 : 0)
  const avgReturn =
    ((previous.avg_return_pct ?? 0) * previous.total_trades + pnl_pct) / n
  const avgDuration =
    ((previous.avg_duration_days ?? 0) * previous.total_trades + durationDays) / n

  await supabase
    .from('setup_performance')
    .update({
      total_trades: n,
      profitable_trades: profitable,
      hit_rate: profitable / n,
      avg_return_pct: avgReturn,
      avg_duration_days: avgDuration,
      updated_at: new Date().toISOString(),
    })
    .eq('setup_id', setup.id)
    .eq('ticker', ticker)
}

function buildMetadata(state: ComputedState | null): Record<string, unknown> {
  if (!state) return {}

  const last = state.candles[state.candles.length - 1]
  const meta: Record<string, unknown> = {}
  if (last) meta.close = last.close

  for (const [period, series] of Object.entries(state.ema)) {
    const val = series[series.length - 1]?.value
    if (val !== undefined) meta[`ema${period}`] = +val.toFixed(4)
  }

  for (const [period, series] of Object.entries(state.rsi)) {
    const val = series[series.length - 1]?.value
    if (val !== undefined) meta[`rsi${period}`] = +val.toFixed(2)
  }

  if (state.macd.length) {
    const m = state.macd[state.macd.length - 1]
    meta.macd = +m.macd.toFixed(4)
    meta.macdSignal = +m.signal.toFixed(4)
    meta.macdHistogram = +m.histogram.toFixed(4)
  }

  if (state.bollinger.length) {
    const b = state.bollinger[state.bollinger.length - 1]
    meta.bollingerUpper = +b.upper.toFixed(4)
    meta.bollingerMiddle = +b.middle.toFixed(4)
    meta.bollingerLower = +b.lower.toFixed(4)
  }

  for (const [period, series] of Object.entries(state.volumeAvg)) {
    const val = series[series.length - 1]?.value
    if (val !== undefined) meta[`volumeAvg${period}`] = +val.toFixed(2)
  }

  return meta
}