import { describe, it, expect } from 'vitest'
import {
  summarizeProvenance,
  estimatedRanges,
  provenanceLabel,
} from '../series-provenance'
import type { DatedSourcePoint } from '../series-provenance'

const live = (snapshot_date: string): DatedSourcePoint => ({ snapshot_date, source: 'live' })
const est = (snapshot_date: string): DatedSourcePoint => ({ snapshot_date, source: 'estimated' })

describe('summarizeProvenance', () => {
  it('counts live and estimated days on a mixed series', () => {
    const result = summarizeProvenance([
      est('2026-04-10'),
      est('2026-04-11'),
      live('2026-07-27'),
    ])

    expect(result.totalDays).toBe(3)
    expect(result.estimatedDays).toBe(2)
    expect(result.liveDays).toBe(1)
    expect(result.hasEstimated).toBe(true)
  })

  it('counts a row with NO source as live, matching migration 033', () => {
    // The column is `not null default 'live'` and rows predating the backfill
    // are real observations. An absent value must not become a third state.
    const result = summarizeProvenance([
      { snapshot_date: '2026-07-23' },
      { snapshot_date: '2026-07-24' },
    ])

    expect(result.liveDays).toBe(2)
    expect(result.estimatedDays).toBe(0)
    expect(result.hasEstimated).toBe(false)
  })

  it('reports the first and last date off the ends of the series', () => {
    const result = summarizeProvenance([est('2026-04-10'), est('2026-05-01'), live('2026-07-28')])

    expect(result.firstDate).toBe('2026-04-10')
    expect(result.lastDate).toBe('2026-07-28')
  })

  it('returns zeros and null dates for an empty series instead of throwing', () => {
    const result = summarizeProvenance([])

    expect(result).toEqual({
      totalDays: 0,
      liveDays: 0,
      estimatedDays: 0,
      hasEstimated: false,
      firstDate: null,
      lastDate: null,
    })
  })

  it('handles an all-estimated series', () => {
    const result = summarizeProvenance([est('2026-04-10'), est('2026-04-11')])

    expect(result.estimatedDays).toBe(2)
    expect(result.liveDays).toBe(0)
    expect(result.hasEstimated).toBe(true)
  })

  it('does NOT re-sort the series — it trusts the caller ordering', () => {
    // fetchSnapshotSeries guarantees ascending order. Re-sorting here would
    // silently paper over a caller that broke that guarantee.
    const result = summarizeProvenance([live('2026-07-28'), live('2026-04-10')])

    expect(result.firstDate).toBe('2026-07-28')
    expect(result.lastDate).toBe('2026-04-10')
  })
})

describe('estimatedRanges', () => {
  it('returns one range for a contiguous estimated run', () => {
    const ranges = estimatedRanges([
      est('2026-04-10'),
      est('2026-04-11'),
      est('2026-04-12'),
      live('2026-07-27'),
    ])

    expect(ranges).toEqual([{ from: '2026-04-10', to: '2026-04-12' }])
  })

  it('returns one range per interleaved run', () => {
    const ranges = estimatedRanges([
      est('2026-04-10'),
      live('2026-04-11'),
      est('2026-04-12'),
      est('2026-04-13'),
      live('2026-04-14'),
    ])

    expect(ranges).toEqual([
      { from: '2026-04-10', to: '2026-04-10' },
      { from: '2026-04-12', to: '2026-04-13' },
    ])
  })

  it('collapses a single estimated day into from === to', () => {
    const ranges = estimatedRanges([live('2026-04-10'), est('2026-04-11'), live('2026-04-12')])

    expect(ranges).toEqual([{ from: '2026-04-11', to: '2026-04-11' }])
  })

  it('returns an empty array when nothing is estimated', () => {
    expect(estimatedRanges([live('2026-04-10'), live('2026-04-11')])).toEqual([])
  })

  it('returns one range spanning the series when everything is estimated', () => {
    const ranges = estimatedRanges([est('2026-04-10'), est('2026-04-11'), est('2026-04-12')])

    expect(ranges).toEqual([{ from: '2026-04-10', to: '2026-04-12' }])
  })

  it('returns an empty array for an empty series', () => {
    expect(estimatedRanges([])).toEqual([])
  })
})

describe('provenanceLabel', () => {
  it('warns and names both counts when the series carries estimated days', () => {
    const label = provenanceLabel(summarizeProvenance([est('2026-04-10'), live('2026-07-27')]))

    expect(label).not.toBeNull()
    expect(label!.tone).toBe('warn')
    expect(label!.text).toContain('2')
    expect(label!.text).toContain('1')
    expect(label!.text).toMatch(/reconstruido/i)
  })

  it('stays muted when every day was measured — no warning where none is warranted', () => {
    const label = provenanceLabel(summarizeProvenance([live('2026-07-27'), live('2026-07-28')]))

    expect(label!.tone).toBe('muted')
    expect(label!.text).toMatch(/medido/i)
    expect(label!.text).not.toMatch(/reconstruido/i)
  })

  it('renders nothing for an empty series', () => {
    expect(provenanceLabel(summarizeProvenance([]))).toBeNull()
  })

  it('renders nothing when a caller sends no provenance block at all', () => {
    // Not a statement about the ONs tab: /api/statistics/ons has sent
    // provenance since it began computing over the ons universe. This pins
    // the undefined case for any future caller that omits it.
    expect(provenanceLabel(undefined)).toBeNull()
  })
})
