'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, LogOut, Search, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase-client'
import { cachedValue } from '@/lib/client-cache'
import { getPortfolio, POSITIONS_KEY } from '@/lib/warren/positions'
import { NAV_ITEMS, PERSONAL_ITEMS, activeHref, type NavItem } from './nav'
import ThemeSwitch from './ThemeSwitch'
import AssetSearch from './AssetSearch'

const linkBase =
  'relative flex min-h-8 items-center gap-2 rounded-md px-2 text-ink-2 hover:bg-hover hover:text-ink max-[819px]:min-h-11'
const linkActive =
  'bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)] before:absolute before:-left-3 before:bottom-2 before:top-2 before:w-0.5 before:rounded before:bg-accent'
const sectionTitle = 'mb-1 px-2 text-xs font-medium uppercase tracking-[0.06em] text-ink-3'
const iconOnly = 'min-[820px]:h-10 min-[820px]:w-11 min-[820px]:justify-center min-[820px]:px-0'

// Gráficos keeps the whole phone screen for the chart: its own bar carries the menu button
// (odd/tasks/grafico-espacio.md S2), so the shell draws no bar there.
const OWN_PHONE_BAR = ['/trading']
const ShellMenu = createContext<{ open: boolean; openMenu: (from: HTMLElement) => void }>({ open: false, openMenu: () => {} })
export const useShellMenu = () => useContext(ShellMenu)

// From 820 px Gráficos keeps only the menu's icons, named by tooltips (odd/tasks/chart-pro-redesign.md S4);
// » pins the full menu open and this device remembers it. The phone drawer is the same everywhere.
const ICON_MENU = ['/trading']
const PIN_KEY = 'warren-menu-pinned'
const PIN_EVENT = 'warren-menu-pin'
// Session fallback for when localStorage is blocked (private mode), as the theme does.
let sessionPinned: boolean | null = null
function readPinned() {
  if (sessionPinned !== null) return sessionPinned
  try { return localStorage.getItem(PIN_KEY) === '1' } catch { return false }
}
function savePinned(value: boolean) {
  try { localStorage.setItem(PIN_KEY, value ? '1' : '0'); sessionPinned = null } catch { sessionPinned = value }
  window.dispatchEvent(new Event(PIN_EVENT))
}
function subscribePinned(onChange: () => void) {
  window.addEventListener(PIN_EVENT, onChange)
  return () => window.removeEventListener(PIN_EVENT, onChange)
}

type Portfolio = Awaited<ReturnType<typeof getPortfolio>>
// The search opens the stock chart, so it only offers stocks and CEDEARs.
const heldOf = (p: Portfolio) => (p.positions ?? []).map(x => x.ticker)

function NavLink({ item, active, mini }: { item: NavItem; active: boolean; mini: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={mini ? item.label : undefined}
      data-tip={mini ? item.label : undefined}
      className={cn(linkBase, active && linkActive, mini && iconOnly, mini && active && 'min-[820px]:before:-left-2')}
    >
      <Icon className="h-4 w-4 flex-none" strokeWidth={1.5} aria-hidden="true" />
      {mini ? <span className="min-[820px]:hidden">{item.label}</span> : item.label}
    </Link>
  )
}

export default function AppShell({ children, pathnameForTest }: { children: React.ReactNode; pathnameForTest?: string }) {
  const routerPath = usePathname()
  const pathname = pathnameForTest ?? routerPath ?? ''
  const current = activeHref(pathname)
  // The menu belongs to the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === pathname
  const [askedHeld, setAskedHeld] = useState<string[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  // The button that opened the menu takes the focus back when it closes.
  const opener = useRef<HTMLElement | null>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  // The portfolio this tab already has; changing section never asks for it again.
  const known = cachedValue<Portfolio>(POSITIONS_KEY)
  const pinned = useSyncExternalStore(subscribePinned, readPinned, () => false)
  const iconMenu = ICON_MENU.includes(current ?? '')
  const mini = iconMenu && !pinned
  // One tooltip for the icon-only menu, drawn outside it: the menu scrolls (and would clip it)
  // and the chart's pane separators sit at z-index 50.
  const [tip, setTip] = useState<{ label: string; left: number; top: number } | null>(null)

  useEffect(() => {
    if (!searchOpen || cachedValue(POSITIONS_KEY)) return
    let cancelled = false
    getPortfolio()
      .then(d => { if (!cancelled) setAskedHeld(heldOf(d)) })
      .catch(() => { /* the search suggestions are optional; the page shows its own errors */ })
    return () => { cancelled = true }
  }, [searchOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
      if (e.key === 'Escape') setTip(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function openMenu(from: HTMLElement) {
    opener.current = from
    setOpenOn(pathname)
  }

  function closeMenu() {
    setOpenOn(null)
    opener.current?.focus()
  }

  function showTip(e: React.SyntheticEvent) {
    const el = (e.target as Element).closest<HTMLElement>('[data-tip]')
    if (!el) return setTip(null)
    const r = el.getBoundingClientRect()
    setTip({ label: el.dataset.tip ?? '', left: r.right + 8, top: r.top + r.height / 2 })
  }

  async function handleLogout() {
    await createClient().auth.signOut({ scope: 'local' })
    // Full page load: the login page is outside the shell and must boot its own theme.
    window.location.assign('/auth/login')
  }

  return (
    <div className={`grid min-h-dvh grid-cols-[minmax(0,1fr)] max-[819px]:content-start bg-canvas text-ink ${mini ? 'min-[820px]:grid-cols-[64px_minmax(0,1fr)]' : 'min-[820px]:grid-cols-[264px_minmax(0,1fr)]'}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Saltar al contenido
      </a>

      {!OWN_PHONE_BAR.includes(current ?? '') && <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-canvas px-2 min-[820px]:hidden">
        <button
          type="button"
          onClick={e => openMenu(e.currentTarget)}
          aria-controls="sidebar"
          aria-expanded={open}
          className="grid h-11 w-11 place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
        >
          <Menu className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          <span className="sr-only">Abrir menú</span>
        </button>
        <span className="font-serif text-xl font-medium leading-none">Warren</span>
      </header>}

      <div
        aria-hidden="true"
        onClick={closeMenu}
        className={cn(
          'fixed inset-0 z-[25] bg-black/30 transition-opacity duration-300 min-[820px]:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        id="sidebar"
        aria-label="Navegación principal"
        onPointerOver={mini ? showTip : undefined}
        onPointerLeave={mini ? () => setTip(null) : undefined}
        onFocus={mini ? showTip : undefined}
        onBlur={mini ? () => setTip(null) : undefined}
        className={cn(
          'flex flex-col gap-5 overflow-y-auto border-r border-line bg-sidebar px-3 py-4 text-sm',
          'min-[820px]:sticky min-[820px]:top-0 min-[820px]:h-dvh',
          'max-[819px]:fixed max-[819px]:inset-y-0 max-[819px]:left-0 max-[819px]:z-30 max-[819px]:h-dvh max-[819px]:w-[min(86vw,320px)] max-[819px]:shadow-toast max-[819px]:transition-transform max-[819px]:duration-300',
          open ? 'max-[819px]:translate-x-0' : 'max-[819px]:invisible max-[819px]:-translate-x-full',
          mini && 'min-[820px]:items-center min-[820px]:gap-3 min-[820px]:px-2',
        )}
      >
        <div className={cn('flex items-center justify-between px-2 pt-1', mini && 'min-[820px]:px-0')}>
          <Link href="/dashboard" className="font-serif text-xl font-medium leading-none tracking-[-0.01em] text-ink">
            {mini ? <><span className="min-[820px]:sr-only">Warren</span><span aria-hidden="true" className="hidden min-[820px]:inline">W</span></> : 'Warren'}
          </Link>
          <button
            ref={closeBtn}
            type="button"
            onClick={closeMenu}
            className="grid h-11 w-11 place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink min-[820px]:hidden"
          >
            <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            <span className="sr-only">Cerrar menú</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-keyshortcuts="Control+K"
          aria-label={mini ? 'Buscar activo' : undefined}
          data-tip={mini ? 'Buscar activo · Ctrl K' : undefined}
          className={cn(
            'flex min-h-[34px] w-full items-center gap-2 rounded-md border border-line bg-surface pl-3 pr-2 text-left text-ink-3 hover:border-line-strong max-[819px]:min-h-11',
            mini && 'min-[820px]:h-10 min-[820px]:w-11 min-[820px]:justify-center min-[820px]:border-transparent min-[820px]:bg-transparent min-[820px]:p-0 min-[820px]:text-ink-2 min-[820px]:hover:border-transparent min-[820px]:hover:bg-hover min-[820px]:hover:text-ink',
          )}
        >
          <Search className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          <span className={cn('flex-1', mini && 'min-[820px]:hidden')}>Buscar activo</span>
          <kbd className={cn('rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink-3', mini && 'min-[820px]:hidden')}>Ctrl K</kbd>
        </button>

        <nav aria-label="Vistas">
          <ul className="grid gap-px">
            {NAV_ITEMS.map(item => (
              <li key={item.href}><NavLink item={item} active={current === item.href} mini={mini} /></li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="h-personal">
          <h2 id="h-personal" className={cn(sectionTitle, mini && 'min-[820px]:sr-only')}>Personal</h2>
          {mini && <div aria-hidden="true" className="mx-auto mb-3 hidden w-7 border-t border-line min-[820px]:block" />}
          <ul className="grid gap-px">
            {PERSONAL_ITEMS.map(item => (
              <li key={item.href}><NavLink item={item} active={current === item.href} mini={mini} /></li>
            ))}
          </ul>
        </nav>

        <div className={cn('mt-auto border-t border-line pt-3', mini && 'min-[820px]:flex min-[820px]:w-full min-[820px]:flex-col min-[820px]:items-center')}>
          <ThemeSwitch compact={mini} />
          <button
            type="button"
            onClick={handleLogout}
            aria-label={mini ? 'Cerrar sesión' : undefined}
            data-tip={mini ? 'Cerrar sesión' : undefined}
            className={cn('flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-ink-2 hover:bg-hover hover:text-ink max-[819px]:min-h-11', mini && iconOnly)}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            {mini ? <span className="min-[820px]:hidden">Cerrar sesión</span> : 'Cerrar sesión'}
          </button>
          {iconMenu && (
            <button
              type="button"
              onClick={() => savePinned(!pinned)}
              aria-controls="sidebar"
              aria-expanded={pinned}
              aria-label={mini ? 'Expandir menú' : undefined}
              data-tip={mini ? 'Expandir menú' : undefined}
              className={cn('mt-1 hidden min-h-9 w-full items-center gap-2 rounded-md px-2 text-ink-3 hover:bg-hover hover:text-ink min-[820px]:flex', mini && iconOnly)}
            >
              {mini
                ? <ChevronsRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                : <><ChevronsLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Contraer menú</>}
            </button>
          )}
        </div>
      </aside>

      {mini && tip && (
        <div
          role="tooltip"
          style={{ left: tip.left, top: tip.top }}
          className="pointer-events-none fixed z-[70] -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1.5 text-xs font-medium text-canvas shadow-pop max-[819px]:hidden"
        >
          {tip.label}
        </div>
      )}

      <AssetSearch open={searchOpen} onClose={() => setSearchOpen(false)} held={known ? heldOf(known) : askedHeld} />

      <main id="main" className="min-w-0">
        <ShellMenu.Provider value={{ open, openMenu }}>{children}</ShellMenu.Provider>
      </main>
    </div>
  )
}
