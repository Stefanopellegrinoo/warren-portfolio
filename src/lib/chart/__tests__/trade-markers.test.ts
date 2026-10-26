// The user's buys and sells on the chart: an arrow per side on the bar that holds them.
import { describe, it, expect } from 'vitest'
import { tradeMarkers, tradesByBar, type Trade } from '../trade-markers'

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000
const trade = (date: string, operation: Trade['operation'], quantity: number, price = 100, id = `${date}-${operation}-${quantity}`): Trade =>
  ({ id, date, operation, quantity, price })
const COLORS = { up: '#0f0', down: '#f00' }
const markersOf = (trades: Trade[], times: number[]) => tradeMarkers(tradesByBar(trades, times), COLORS)

// Mon 2026-10-19 to Fri 2026-10-23, as daily bars come (UTC midnight of each business day).
const DAILY = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map(day)

describe('trade markers', () => {
  it('a buy is a green arrow under its day\'s bar that says "C" and the quantity', () => {
    expect(markersOf([trade('2026-10-20', 'COMPRA', 10)], DAILY)).toEqual([
      { time: day('2026-10-20'), position: 'belowBar', shape: 'arrowUp', color: '#0f0', text: 'C 10' },
    ])
  })

  it('a sell is a red arrow over its day\'s bar that says "V" and the quantity', () => {
    expect(markersOf([trade('2026-10-22', 'VENTA', 5)], DAILY)).toEqual([
      { time: day('2026-10-22'), position: 'aboveBar', shape: 'arrowDown', color: '#f00', text: 'V 5' },
    ])
  })

  it('several trades on one bar make one arrow per side, their quantities added', () => {
    const trades = [trade('2026-10-21', 'COMPRA', 10), trade('2026-10-21', 'COMPRA', 2.5), trade('2026-10-21', 'VENTA', 4)]

    expect(markersOf(trades, DAILY)).toEqual([
      { time: day('2026-10-21'), position: 'belowBar', shape: 'arrowUp', color: '#0f0', text: 'C 12,5' },
      { time: day('2026-10-21'), position: 'aboveBar', shape: 'arrowDown', color: '#f00', text: 'V 4' },
    ])
  })

  it('quantities keep their own decimals, up to six, with the app\'s number format', () => {
    const trades = [trade('2026-10-19', 'COMPRA', 0.1), trade('2026-10-19', 'COMPRA', 0.2), trade('2026-10-20', 'VENTA', 1500)]

    expect(markersOf(trades, DAILY).map((m) => m.text)).toEqual(['C 0,3', 'V 1.500'])
  })

  it('on a weekly chart a trade goes in the week that holds it', () => {
    const weeks = ['2026-10-12', '2026-10-19', '2026-10-26'].map(day)
    const trades = [trade('2026-10-22', 'COMPRA', 3), trade('2026-10-20', 'COMPRA', 1), trade('2026-10-13', 'VENTA', 2)]

    expect(markersOf(trades, weeks)).toEqual([
      { time: day('2026-10-12'), position: 'aboveBar', shape: 'arrowDown', color: '#f00', text: 'V 2' },
      { time: day('2026-10-19'), position: 'belowBar', shape: 'arrowUp', color: '#0f0', text: 'C 4' },
    ])
  })

  it('on a monthly chart a trade goes in its month', () => {
    const months = ['2026-08-01', '2026-09-01', '2026-10-01'].map(day)

    expect(markersOf([trade('2026-09-30', 'COMPRA', 1)], months).map((m) => m.time)).toEqual([day('2026-09-01')])
  })

  it('intraday a trade goes in the first bar of its day', () => {
    // Hourly bars of 2026-10-20 and 2026-10-21, from the 13:30 UTC open.
    const open = (date: string) => day(date) + 13.5 * 3600
    const hours = [open('2026-10-20'), open('2026-10-20') + 3600, open('2026-10-21'), open('2026-10-21') + 3600]

    expect(markersOf([trade('2026-10-21', 'VENTA', 1)], hours).map((m) => m.time)).toEqual([open('2026-10-21')])
  })

  it('a trade on a day with no bar goes in the last bar before it', () => {
    // Saturday 2026-10-24: Friday's bar.
    expect(markersOf([trade('2026-10-24', 'COMPRA', 1)], DAILY).map((m) => m.time)).toEqual([day('2026-10-23')])
  })

  it('a trade before the first bar is left out', () => {
    expect(markersOf([trade('2026-10-01', 'COMPRA', 1)], DAILY)).toEqual([])
  })

  it('dividends get no arrow and are not in the bar\'s trades', () => {
    const trades = [trade('2026-10-20', 'DIVIDENDO', 7), trade('2026-10-20', 'COMPRA', 1)]

    expect(markersOf(trades, DAILY).map((m) => m.text)).toEqual(['C 1'])
    expect(tradesByBar(trades, DAILY).get(day('2026-10-20'))!.map((t) => t.operation)).toEqual(['COMPRA'])
  })

  it('keeps each bar\'s trades, oldest first, for the card', () => {
    const weeks = ['2026-10-19'].map(day)
    // The API sends the newest first.
    const trades = [trade('2026-10-22', 'VENTA', 1), trade('2026-10-20', 'COMPRA', 2)]

    expect(tradesByBar(trades, weeks).get(day('2026-10-19'))!.map((t) => t.date)).toEqual(['2026-10-20', '2026-10-22'])
  })

  it('the arrows come in time order, as the chart needs them', () => {
    const trades = [trade('2026-10-23', 'COMPRA', 1), trade('2026-10-19', 'COMPRA', 1)]

    expect(markersOf(trades, DAILY).map((m) => m.time)).toEqual([day('2026-10-19'), day('2026-10-23')])
  })
})
