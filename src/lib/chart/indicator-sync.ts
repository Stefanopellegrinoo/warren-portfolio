import { useChartStore, type IndicatorKey } from '@/lib/store/chart-store'
import { INDICATOR_KEYS, type IndicatorVisibility } from './preferences-schema'
import { getPreferences, isAccountLoaded, setIndicatorVisibility, subscribe } from './preferences'

/**
 * Which indicators are on, hidden or minimized, kept in the account (odd/tasks/chart-pro-redesign.md S2) so the
 * phone and the computer show the same set. The chart store stays this device's copy: the first paint and
 * offline use read it.
 *
 * - Once the account answered, every indicator it keeps them for is shown that way here; one it keeps nothing
 *   for (the first time after this shipped) is saved as this device has it, so the account ends up with all ten.
 * - A change here (on, hidden, minimized), before the account answered too, saves that indicator alone through
 *   the account's outbox (src/lib/chart/preferences.ts): debounced, kept on the device, sent once it answers.
 * - Showing the account's set here saves nothing back.
 */

type ChartState = ReturnType<typeof useChartStore.getState>

const visibilityOf = (s: ChartState, key: IndicatorKey): Required<IndicatorVisibility> => ({
  on: !!s.indicators[key],
  hidden: !!s.hidden[key],
  minimized: !!s.minimized[key],
})

const differs = (a: ChartState, b: ChartState, key: IndicatorKey) =>
  a.indicators[key] !== b.indicators[key] || a.hidden[key] !== b.hidden[key] || a.minimized[key] !== b.minimized[key]

// Set while the account's set is shown here, so the store's change it makes is not saved back.
let applying = false

/** The account's set into the store, and to the account what it keeps nothing for. */
function reconcile() {
  if (!isAccountLoaded()) return
  const kept = getPreferences().indicatorSettings
  const store = useChartStore.getState()
  const next = { indicators: { ...store.indicators }, hidden: { ...store.hidden }, minimized: { ...store.minimized } }
  const missing: Partial<Record<IndicatorKey, IndicatorVisibility>> = {}
  for (const key of INDICATOR_KEYS) {
    const { on, hidden, minimized } = kept[key] ?? {}
    if (on === undefined && hidden === undefined && minimized === undefined) missing[key] = visibilityOf(store, key)
    if (on !== undefined) next.indicators[key] = on
    if (hidden !== undefined) next.hidden[key] = hidden
    if (minimized !== undefined) next.minimized[key] = minimized
  }
  if (INDICATOR_KEYS.some((key) => differs({ ...store, ...next }, store, key))) {
    applying = true
    try {
      useChartStore.setState(next)
    } finally {
      applying = false
    }
  }
  if (Object.keys(missing).length > 0) setIndicatorVisibility(missing)
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
