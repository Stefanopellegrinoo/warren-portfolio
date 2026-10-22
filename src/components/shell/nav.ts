import { Home, LineChart, List, PieChart, Landmark, Bell, Wallet, type LucideIcon } from 'lucide-react'

export interface NavItem { href: string; label: string; icon: LucideIcon }

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Resumen', icon: Home },
  { href: '/trading', label: 'Gráficos', icon: LineChart },
  { href: '/history', label: 'Operaciones', icon: List },
  { href: '/statistics', label: 'Rendimiento', icon: PieChart },
  { href: '/ons', label: 'Obligaciones negociables', icon: Landmark },
  { href: '/strategies', label: 'Estrategias y alertas', icon: Bell },
]

export const PERSONAL_ITEMS: NavItem[] = [
  { href: '/cashflow', label: 'Gastos', icon: Wallet },
]

const ALL_HREFS = [...NAV_ITEMS, ...PERSONAL_ITEMS].map(i => i.href)

/** The menu entry that owns `pathname`: longest matching section prefix. */
export function activeHref(pathname: string): string | null {
  const matches = ALL_HREFS.filter(h => pathname === h || pathname.startsWith(h + '/'))
  return matches.sort((a, b) => b.length - a.length)[0] ?? null
}

export function topHoldings(
  positions: { ticker: string; market_value?: number }[],
  total: number,
  n = 5,
): { ticker: string; weightPct: number }[] {
  return positions
    .filter((p): p is { ticker: string; market_value: number } => typeof p.market_value === 'number' && isFinite(p.market_value))
    .sort((a, b) => b.market_value - a.market_value)
    .slice(0, n)
    .map(p => ({ ticker: p.ticker, weightPct: total > 0 ? (p.market_value / total) * 100 : 0 }))
}
