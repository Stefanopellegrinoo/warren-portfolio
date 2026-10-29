import type { IndicatorKey } from '@/lib/store/chart-store'
import {
  EMPTY_PREFERENCES,
  applyPatch,
  cleanPatch,
  isEmptyPatch,
  mergePatch,
  parsePreferences,
  type ChartPreferences,
  type IndicatorSettings,
  type IndicatorVisibility,
  type PreferencesPatch,
  type RememberedStyle,
  type ToolKind,
} from './preferences-schema'

/**
 * This tab's copy of the account's chart preferences (odd/tasks/chart-customization.md S4).
 *
 * - Loads once per tab, on the first subscriber; until it answers, and whenever it fails, the chart
 *   uses this device's last copy (localStorage).
 * - A change applies at once, is kept on the device in an outbox, and is saved per key after
 *   SAVE_DELAY_MS of quiet. Nothing retries on its own: a failed load or save is tried again with the
 *   next change (or the next tab), so a missing table (migration 051 not applied) costs one request
 *   per change, never a loop, and shows no error.
 * - Writes go only after the account answered in this tab: the outbox is stamped with its account, and
 *   another account's outbox on the same browser is dropped instead of sent, as is one saved before the
 *   device ever reached an account (it has no owner to check).
 * - Tabs of this browser share the device copy: every write reads it first and adds this tab's change to
 *   what another tab stored for the same account, a save takes out only the values the account
 *   confirmed, and a tab shows another tab's change when it lands (the `storage` event). Two tabs may
 *   send the same entry: the account merges per key, so that costs a request, never a value.
 */
const ENDPOINT = '/api/chart-preferences'
const STORAGE_KEY = 'warren:chart-preferences'
export const SAVE_DELAY_MS = 800
// Browsers cap keepalive bodies at 64 KB in flight: a bigger save on the way out stays in the outbox.
const KEEPALIVE_MAX_BYTES = 60_000

let started = false
let requested = false
let loaded = false
let loading: Promise<void> | null = null
let owner: string | null = null
let state: ChartPreferences = EMPTY_PREFERENCES
let answer: ChartPreferences | null = null
let pending: PreferencesPatch = {}
let sending: PreferencesPatch | null = null
let timer: ReturnType<typeof setTimeout> | null = null
// The device copy as this tab last read or wrote it: anything else was written by another tab.
let seen: string | null = null
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((l) => l())

/**
 * Takes the device copy when another tab changed it, so this tab's next write adds to it instead of
 * replacing it. Answers whether this tab's preferences changed.
 */
function readDevice(): boolean {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return false // No storage (private mode, blocked site data): this tab keeps them in memory.
  }
  // Unchanged since this tab's last write; also keeps this tab's changes when that write failed (quota).
  if (raw === seen) return false
  seen = raw
  let saved: { owner?: unknown; preferences?: unknown; pending?: unknown } | null
  try {
    saved = JSON.parse(raw ?? 'null')
  } catch {
    return false // A broken copy: same.
  }
  if (!saved || typeof saved !== 'object') return false
  const savedOwner = typeof saved.owner === 'string' ? saved.owner : null
  // Another account's copy, or one that never reached an account, is not this tab's to show or send.
  if (owner && savedOwner !== owner) return false
  // Until the account answers, what this tab changed is its own and goes on top of the device copy.
  const own = owner ? {} : pending
  state = applyPatch(parsePreferences(saved.preferences), own)
  // An outbox saved before this device ever reached an account has no owner to check on load: it
  // would go to whichever account signs in next, so it stays on the device and is never sent.
  pending = mergePatch(savedOwner ? cleanPatch(saved.pending) : {}, own)
  owner = savedOwner
  return true
}

function writeDevice() {
  try {
    const json = JSON.stringify({ owner, preferences: state, pending })
    window.localStorage.setItem(STORAGE_KEY, json)
    seen = json
  } catch {
    // Same: memory only.
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The outbox without what the account confirmed; an entry changed since (here or in another tab) stays. */
function unsent(outbox: PreferencesPatch, sent: PreferencesPatch): PreferencesPatch {
  const left = Object.entries(outbox).map(([section, entries]) => {
    const confirmed: Record<string, unknown> = sent[section as keyof PreferencesPatch] ?? {}
    return [section, Object.fromEntries(Object.entries(entries ?? {}).filter(([key, value]) => !same(confirmed[key], value)))] as const
  })
  return Object.fromEntries(left.filter(([, entries]) => Object.keys(entries).length > 0))
}

function init() {
  if (started || typeof window === 'undefined') return
  started = true
  readDevice()
  // A PWA sent to the background may never come back: save now, not SAVE_DELAY_MS later.
  const leave = () => { if (timer) flush(true) }
  window.addEventListener('pagehide', leave)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave() })
  // Another tab changed the device copy: show its change now, and add to it on this tab's next write.
  window.addEventListener('storage', () => { if (readDevice()) notify() })
}

function load(): Promise<void> {
  loading ??= fetch(ENDPOINT)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const body = await res.json()
      if (typeof body?.userId !== 'string') throw new Error('No account')
      readDevice()
      if (owner && owner !== body.userId) pending = {}
      owner = body.userId
      loaded = true
      answer = parsePreferences(body.preferences)
      // What this tab changed while loading (or saved before, offline) wins over the account's copy.
      state = applyPatch(answer, pending)
      writeDevice()
      notify()
      if (!isEmptyPatch(pending)) schedule()
    })
    .catch(() => {
      // Table missing, offline, signed out: this device's values stay; the next change tries again.
    })
    .finally(() => { loading = null })
  return loading
}

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => flush(), SAVE_DELAY_MS)
}

function flush(leaving = false) {
  if (timer) clearTimeout(timer)
  timer = null
  if (sending) return // one save at a time; what changed meanwhile goes when it answers
  if (!loaded) { void load(); return } // a successful load schedules the outbox itself
  if (readDevice()) notify() // the outbox as it is now: another tab may have sent part of it or changed it
  if (isEmptyPatch(pending)) return

  // What goes stays in the outbox until the account confirms it.
  // ponytail: two tabs' saves in flight at once can land out of order for one key; a Web Lock around the save if that shows.
  const body = JSON.stringify(pending)
  sending = pending
  fetch(ENDPOINT, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: leaving && body.length < KEEPALIVE_MAX_BYTES,
  })
    // A 400 would never pass: dropping it keeps one bad entry from blocking every later save.
    .then((res) => res.ok || res.status === 400, () => false)
    .then((done) => {
      if (done) {
        if (readDevice()) notify()
        pending = unsent(pending, sending!)
        writeDevice()
      }
      sending = null
      if (done && !isEmptyPatch(pending)) schedule()
    })
}

function change(patch: PreferencesPatch) {
  init()
  const valid = cleanPatch(patch)
  if (isEmptyPatch(valid)) return
  readDevice()
  state = applyPatch(state, valid)
  pending = mergePatch(pending, valid)
  writeDevice()
  notify()
  schedule()
}

/** The preferences as the account answered them in this tab, before this device's changes; null until then. */
export function getAccountAnswer(): ChartPreferences | null {
  return answer
}

export function getPreferences(): ChartPreferences {
  init()
  return state
}

export function subscribe(listener: () => void): () => void {
  init()
  listeners.add(listener)
  if (!requested) {
    requested = true
    void load()
  }
  return () => { listeners.delete(listener) }
}

export function setFavorite(kind: ToolKind, starred: boolean) {
  change({ favorites: { [kind]: starred ? true : null } })
}

/** The style new drawings of `kind` come out with; null goes back to the library's factory style. */
export function setToolStyle(kind: ToolKind, style: RememberedStyle | null) {
  change({ toolStyles: { [kind]: style } })
}

/** Saves an indicator's settings to the account; null forgets them (the device's values apply again). */
export function setIndicatorSettings(key: IndicatorKey, settings: IndicatorSettings | null) {
  change({ indicatorSettings: { [key]: settings } })
}

/**
 * Saves whether these indicators are on, hidden or minimized (odd/tasks/chart-pro-redesign.md S2), each apart
 * from its settings: a change made before the account answers wins over that indicator's visibility only.
 */
export function setIndicatorVisibility(changes: Partial<Record<IndicatorKey, IndicatorVisibility>>) {
  change({ indicatorVisibility: changes })
}
