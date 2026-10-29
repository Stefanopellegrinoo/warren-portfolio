import { useChartStore, type IndicatorKey } from '@/lib/store/chart-store'
import { INDICATOR_KEYS, type ChartPreferences, type IndicatorVisibility } from './preferences-schema'
import { getAccountAnswer, getPreferences, setIndicatorVisibility, subscribe } from './preferences'

/**
 * Which indicators are on, hidden or minimized, kept in the account (odd/tasks/chart-pro-redesign.md S2) so the
 * phone and the computer show the same set. The chart store stays this device's copy: the first paint and
 * offline use read it. Each indicator's visibility is kept apart from its settings, so nothing here ever
 * writes an indicator's values or style.
 *
 * - Once the account answered, every indicator it shows a way is shown that way here (a change made here before
 *   it answered wins for that indicator). One the answer has nothing for (the first time after this shipped, or
 *   an indicator added later) is saved as this device has it, once per answer.
 * - A change here saves that indicator's visibility alone through the account's outbox
 *   (src/lib/chart/preferences.ts): debounced, kept on the device, sent once the account answers.
 * - Showing the account's set here saves nothing back.
 */

type ChartState = ReturnType<typeof useChartStore.getState>

const visibilityOf = (s: ChartState, key: IndicatorKey): IndicatorVisibility => ({
  on: !!s.indicators[key],
  hidden: !!s.hidden[key],
  minimized: !!s.minimized[key],
})

const differs = (a: ChartState, b: ChartState, key: IndicatorKey) =>
  a.indicators[key] !== b.indicators[key] || a.hidden[key] !== b.hidden[key] || a.minimized[key] !== b.minimized[key]

// Set while the account's set is shown here, so the store's change it makes is not saved back.
let applying = false
// The account's answer whose missing indicators were already saved.
let filled: ChartPreferences | null = null

/** The account's set into the store, and to the account what its answer has nothing for. */
function reconcile() {
  const answer = getAccountAnswer()
  if (!answer) return
  const kept = getPreferences().indicatorVisibility
  const store = useChartStore.getState()
  const next = { indicators: { ...store.indicators }, hidden: { ...store.hidden }, minimized: { ...store.minimized } }
  for (const key of INDICATOR_KEYS) {
    const v = kept[key]
    if (!v) continue
    next.indicators[key] = v.on
    next.hidden[key] = v.hidden
    next.minimized[key] = v.minimized
  }
  const shown = { ...store, ...next }
  if (INDICATOR_KEYS.some((key) => differs(shown, store, key))) {
    applying = true
    try {
      useChartStore.setState(next)
    } finally {
      applying = false
    }
  }
  if (filled === answer) return
  filled = answer
  // From the answer, never from this device's copy alone: an older build may have rewritten it without them.
  const missing = INDICATOR_KEYS.filter((key) => !answer.indicatorVisibility[key])
  if (missing.length > 0) setIndicatorVisibility(Object.fromEntries(missing.map((key) => [key, visibilityOf(shown, key)])))
}

function save(s: ChartState, prev: ChartState) {
  if (applying || (s.indicators === prev.indicators && s.hidden === prev.hidden && s.minimized === prev.minimized)) return
  const changed = INDICATOR_KEYS.filter((key) => differs(s, prev, key))
  if (changed.length > 0) setIndicatorVisibility(Object.fromEntries(changed.map((key) => [key, visibilityOf(s, key)])))
}

/** Started by the Trading page; answers how to stop. */
export function startIndicatorSync(): () => void {
  const stopAccount = subscribe(reconcile)
  const stopStore = useChartStore.subscribe(save)
  reconcile()
  return () => {
    stopAccount()
    stopStore()
  }
}
