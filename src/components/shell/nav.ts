import { Home, LineChart, List, PieChart, Landmark, Bell, Wallet, type LucideIcon } from 'lucide-react'

// `section`: the path prefix the entry owns when it differs from where it opens.
export interface NavItem { href: string; label: string; icon: LucideIcon; section?: string }

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Resumen', icon: Home },
  { href: '/trading', label: 'Gráficos', icon: LineChart },
  { href: '/history', label: 'Operaciones', icon: List },
  { href: '/statistics', label: 'Rendimiento', icon: PieChart },
  { href: '/ons/mi-cartera', section: '/ons', label: 'Obligaciones negociables', icon: Landmark },
  { href: '/strategies', label: 'Estrategias y alertas', icon: Bell },
]

export const PERSONAL_ITEMS: NavItem[] = [
  { href: '/cashflow', label: 'Gastos', icon: Wallet },
]

const ALL_ITEMS = [...NAV_ITEMS, ...PERSONAL_ITEMS]

/** The menu entry that owns `pathname` (its href): longest matching section prefix. */
export function activeHref(pathname: string): string | null {
  const matches = ALL_ITEMS.filter(({ href, section = href }) => pathname === section || pathname.startsWith(section + '/'))
  return matches.sort((a, b) => (b.section ?? b.href).length - (a.section ?? a.href).length)[0]?.href ?? null
}

/** The asset page of a ticker as the app stores it (`MELI`, `BCBA:GGAL`) or as Yahoo names it (`GGAL.BA`). */
export const assetHref = (ticker: string) => `/activo/${encodeURIComponent(ticker)}`
