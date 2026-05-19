'use client'

import { TrendingUp, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

type MobileView = 'chart' | 'watchlist'

interface TabConfig {
  label: string
  icon: string
}

// Named exports for unit testing
export function getTabConfig(view: MobileView): TabConfig {
  if (view === 'chart') {
    return { label: 'Chart', icon: 'TrendingUp' }
  }
  return { label: 'Watchlist', icon: 'Star' }
}

export function isActiveView(view: MobileView, activeView: MobileView): boolean {
  return view === activeView
}

interface MobileBottomNavProps {
  activeView: MobileView
  onViewChange: (view: MobileView) => void
}

const TABS: { view: MobileView; Icon: typeof TrendingUp }[] = [
  { view: 'chart', Icon: TrendingUp },
  { view: 'watchlist', Icon: Star },
]

export default function MobileBottomNav({ activeView, onViewChange }: MobileBottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 h-14 md:hidden border-t border-tv-border bg-tv-panel flex">
      {TABS.map(({ view, Icon }) => {
        const active = isActiveView(view, activeView)
        const config = getTabConfig(view)
        return (
          <button
            key={view}
            type="button"
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors',
              active
                ? 'text-tv-green border-t-2 border-tv-green -mt-px'
                : 'text-tv-text-muted hover:text-tv-text'
            )}
            onClick={() => onViewChange(view)}
            aria-label={config.label}
            aria-pressed={active}
          >
            <Icon size={18} strokeWidth={1.75} />
            <span>{config.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
