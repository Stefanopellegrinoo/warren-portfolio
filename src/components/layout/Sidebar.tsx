'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, History, DollarSign, LogOut, TrendingUp, PieChart, BookOpen, LineChart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase-client'
import { useRouter } from 'next/navigation'

const NAV = [
  { href: '/dashboard',  label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/history',    label: 'Historial',    icon: History },
  { href: '/cashflow',   label: 'Cash Flow',    icon: DollarSign },
  { href: '/statistics', label: 'Estadísticas', icon: PieChart },
  { href: '/trading',    label: 'Trading',      icon: LineChart },
  { href: '/strategies', label: 'Estrategias',  icon: BookOpen },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const sb = createClient()
    await sb.auth.signOut({ scope: 'local' })
    // Refresh router state to ensure proper authentication state update
    // This prevents flash of authenticated content before redirect
    router.refresh()
    router.push('/auth/login')
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 h-screen w-56 flex-col z-40 border-r border-white/[0.05]"
             style={{ background: 'linear-gradient(180deg, #060d18 0%, #040810 100%)' }}>
        
        {/* Logo */}
        <div className="px-5 py-6 border-b border-white/[0.05]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber flex items-center justify-center glow-amber">
              <TrendingUp className="w-4 h-4 text-bg-900" strokeWidth={2.5} />
            </div>
            <span className="font-display font-800 text-white tracking-tight">WARREN</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-1 font-mono">PORTFOLIO TRACKER</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link key={href} href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-display font-600 transition-all duration-150',
                  active
                    ? 'bg-amber/10 text-amber border border-amber/20'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                )}>
                <Icon className={cn('w-4 h-4', active ? 'text-amber' : '')} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-white/[0.05]">
          <button onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-600
                       hover:text-rose hover:bg-rose/5 transition-all duration-150 font-display">
            <LogOut className="w-4 h-4" />
            Salir
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="flex md:hidden fixed bottom-0 left-0 w-full z-50 px-4 py-3 justify-between items-center border-t border-white/[0.05]"
           style={{ background: 'linear-gradient(180deg, #060d18 0%, #040810 100%)' }}>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          // Shorten labels for mobile
          const shortLabel = label === 'Dashboard' ? 'Home' : label === 'Estadísticas' ? 'Stats' : label
          return (
            <Link key={href} href={href} 
              className={cn(
                'flex flex-col items-center gap-1.5 transition-all w-16',
                active ? 'text-amber' : 'text-slate-500'
              )}>
              <Icon className={cn('w-5 h-5', active ? 'drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]' : '')} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] font-display font-600">{shortLabel}</span>
            </Link>
          )
        })}
        
        {/* Logout button for mobile */}
        <button onClick={handleLogout}
          className="flex flex-col items-center gap-1.5 transition-all w-16 text-slate-500 hover:text-rose">
          <LogOut className="w-5 h-5" strokeWidth={2} />
          <span className="text-[10px] font-display font-600">Salir</span>
        </button>
      </nav>
    </>
  )
}
