'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'
import { THEME_STORAGE_KEY, parseThemePref, resolveTheme, type ThemePref } from '@/lib/theme'

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

function applyTheme(pref: ThemePref) {
  const t = resolveTheme(pref)
  if (t) document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
}

// `compact`: the page may show the icon-only menu (Gráficos). While <html data-menu="icons">, from 820 px,
// one button cycles the same choice; pinned open and below 820 px the radio group shows.
export default function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const pref = useSyncExternalStore(subscribe, getPref, () => 'system' as ThemePref)

  useEffect(() => { applyTheme(pref) }, [pref])

  const group = (
    <fieldset
      role="radiogroup"
      aria-label="Tema"
      className="flex w-full gap-0.5 rounded-md border border-line bg-surface-2 p-0.5"
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
  )
  if (!compact) return <div className="mb-3">{group}</div>

  const i = OPTIONS.findIndex(o => o.value === pref)
  const { label, icon: Icon } = OPTIONS[i]
  return (
    <>
      <div className="mb-3 min-[820px]:[[data-menu=icons]_&]:hidden">{group}</div>
      <button
        type="button"
        onClick={() => savePref(OPTIONS[(i + 1) % OPTIONS.length].value)}
        aria-label={`Tema: ${label}`}
        data-tip={`Tema: ${label}`}
        className="mb-1 hidden h-10 w-11 place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink min-[820px]:[[data-menu=icons]_&]:grid"
      >
        <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      </button>
    </>
  )
}
