'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, LogOut, Search } from 'lucide-react'
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

type Portfolio = Awaited<ReturnType<typeof getPortfolio>>
// The search opens the stock chart, so it only offers stocks and CEDEARs.
const heldOf = (p: Portfolio) => (p.positions ?? []).map(x => x.ticker)

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={cn(linkBase, active && linkActive)}>
      <Icon className="h-4 w-4 flex-none" strokeWidth={1.5} aria-hidden="true" />
      {item.label}
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
  const openBtn = useRef<HTMLButtonElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  // The portfolio this tab already has; changing section never asks for it again.
  const known = cachedValue<Portfolio>(POSITIONS_KEY)

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

  function closeMenu() {
    setOpenOn(null)
    openBtn.current?.focus()
  }

  async function handleLogout() {
    await createClient().auth.signOut({ scope: 'local' })
    // Full page load: the login page is outside the shell and must boot its own theme.
    window.location.assign('/auth/login')
  }

  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] max-[819px]:content-start bg-canvas text-ink min-[820px]:grid-cols-[264px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Saltar al contenido
      </a>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-canvas px-2 min-[820px]:hidden">
        <button
          ref={openBtn}
          type="button"
          onClick={() => setOpenOn(pathname)}
          aria-controls="sidebar"
          aria-expanded={open}
          className="grid h-11 w-11 place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
        >
          <Menu className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          <span className="sr-only">Abrir menú</span>
        </button>
        <span className="font-serif text-xl font-medium leading-none">Warren</span>
      </header>

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
        className={cn(
          'flex flex-col gap-5 overflow-y-auto border-r border-line bg-sidebar px-3 py-4 text-sm',
          'min-[820px]:sticky min-[820px]:top-0 min-[820px]:h-dvh',
          'max-[819px]:fixed max-[819px]:inset-y-0 max-[819px]:left-0 max-[819px]:z-30 max-[819px]:h-dvh max-[819px]:w-[min(86vw,320px)] max-[819px]:shadow-toast max-[819px]:transition-transform max-[819px]:duration-300',
          open ? 'max-[819px]:translate-x-0' : 'max-[819px]:invisible max-[819px]:-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-2 pt-1">
          <Link href="/dashboard" className="font-serif text-xl font-medium leading-none tracking-[-0.01em] text-ink">Warren</Link>
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
          className="flex min-h-[34px] w-full items-center gap-2 rounded-md border border-line bg-surface pl-3 pr-2 text-left text-ink-3 hover:border-line-strong max-[819px]:min-h-11"
        >
          <Search className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          <span className="flex-1">Buscar activo</span>
          <kbd className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink-3">Ctrl K</kbd>
        </button>

        <nav aria-label="Vistas">
          <ul className="grid gap-px">
            {NAV_ITEMS.map(item => (
              <li key={item.href}><NavLink item={item} active={current === item.href} /></li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="h-personal">
          <h2 id="h-personal" className={sectionTitle}>Personal</h2>
          <ul className="grid gap-px">
            {PERSONAL_ITEMS.map(item => (
              <li key={item.href}><NavLink item={item} active={current === item.href} /></li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto border-t border-line pt-3">
          <ThemeSwitch />
          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-ink-2 hover:bg-hover hover:text-ink max-[819px]:min-h-11"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <AssetSearch open={searchOpen} onClose={() => setSearchOpen(false)} held={known ? heldOf(known) : askedHeld} />

      <main id="main" className="min-w-0">
        {children}
      </main>
    </div>
  )
}
