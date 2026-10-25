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
let pending: PreferencesPatch = {}
let sending: PreferencesPatch | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((l) => l())

function readDevice() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!saved) return
    state = parsePreferences(saved.preferences)
    owner = typeof saved.owner === 'string' ? saved.owner : null
    // An outbox saved before this device ever reached an account has no owner to check on load: it
    // would go to whichever account signs in next, so it stays on the device and is never sent.
    pending = owner ? cleanPatch(saved.pending) : {}
  } catch {
    // No storage (private mode, blocked site data) or a broken copy: this tab keeps them in memory.
  }
}

function writeDevice() {
  try {
    const outbox = sending ? mergePatch(sending, pending) : pending
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ owner, preferences: state, pending: outbox }))
  } catch {
    // Same: memory only.
  }
}

function init() {
  if (started || typeof window === 'undefined') return
  started = true
  readDevice()
  // A PWA sent to the background may never come back: save now, not SAVE_DELAY_MS later.
  const leave = () => { if (timer) flush(true) }
  window.addEventListener('pagehide', leave)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave() })
}

function load(): Promise<void> {
  loading ??= fetch(ENDPOINT)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const body = await res.json()
      if (typeof body?.userId !== 'string') throw new Error('No account')
      if (owner && owner !== body.userId) pending = {}
      owner = body.userId
      loaded = true
      // What this tab changed while loading (or saved before, offline) wins over the account's copy.
      state = applyPatch(applyPatch(parsePreferences(body.preferences), sending ?? {}), pending)
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
  if (isEmptyPatch(pending)) return

  const body = JSON.stringify(pending)
  sending = pending
  pending = {}
  fetch(ENDPOINT, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: leaving && body.length < KEEPALIVE_MAX_BYTES,
  })
    // A 400 would never pass: dropping it keeps one bad entry from blocking every later save.
    .then((res) => res.ok || res.status === 400, () => false)
    .then((done) => {
      if (!done) pending = mergePatch(sending!, pending)
      sending = null
      writeDevice()
      if (done && !isEmptyPatch(pending)) schedule()
    })
}

function change(patch: PreferencesPatch) {
  init()
  const valid = cleanPatch(patch)
  if (isEmptyPatch(valid)) return
  state = applyPatch(state, valid)
  pending = mergePatch(pending, valid)
  writeDevice()
  notify()
  schedule()
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
