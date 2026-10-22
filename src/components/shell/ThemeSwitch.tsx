'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'
import { THEME_STORAGE_KEY, isRedesigned, parseThemePref, resolveTheme, type ThemePref } from '@/lib/theme'

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
]

const CHANGE_EVENT = 'warren-theme-change'

function readPref(): ThemePref {
  try { return parseThemePref(localStorage.getItem(THEME_STORAGE_KEY)) } catch { return 'system' }
}

// Session fallback for when localStorage is blocked (private mode).
let sessionPref: ThemePref | null = null
const getPref = () => sessionPref ?? readPref()

function savePref(value: ThemePref) {
  try { localStorage.setItem(THEME_STORAGE_KEY, value); sessionPref = null } catch { sessionPref = value }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

function applyTheme(pref: ThemePref, pathname: string) {
  const t = resolveTheme(pref, pathname)
  if (t) document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
}

export default function ThemeSwitch({ pathname }: { pathname: string }) {
  const pref = useSyncExternalStore(subscribe, getPref, () => 'system' as ThemePref)
  const enabled = isRedesigned(pathname)

  useEffect(() => { applyTheme(pref, pathname) }, [pref, pathname])

  return (
    <div className="mb-3">
      <fieldset
        disabled={!enabled}
        role="radiogroup"
        aria-label="Tema"
        aria-describedby={enabled ? undefined : 'theme-note'}
        className="flex w-full gap-0.5 rounded-md border border-line bg-surface-2 p-0.5 disabled:opacity-60"
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className="relative flex min-h-8 flex-1 cursor-pointer items-center justify-center gap-1 rounded px-1 text-[13px] text-ink-2 has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-[0_0_0_1px_var(--line)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring max-[819px]:min-h-11"
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={pref === value}
              onChange={() => savePref(value)}
              className="absolute inset-0 m-0 cursor-pointer opacity-0"
            />
            <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            {label}
          </label>
        ))}
      </fieldset>
      {!enabled && (
        <p id="theme-note" className="mt-1.5 px-1 text-xs text-ink-3">Esta página todavía usa el estilo anterior</p>
      )}
    </div>
  )
}
