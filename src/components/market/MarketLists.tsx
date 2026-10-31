'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { field, label as labelCls } from '@/components/ons/ui'

export interface ListEntry { key: string; name: string; count: number | null }

interface Props {
  market: ListEntry[]
  mine: ListEntry[]
  selected: string
  onSelect: (key: string) => void
  /** Under the user's lists: "Nueva lista" (odd/tasks/market-page.md T5). */
  footer?: ReactNode
}

// The look of the app's own menu (components/shell/AppShell.tsx): the same rows and section titles.
const ITEM = 'relative flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm text-ink-2 hover:bg-hover hover:text-ink'
const SECTION = 'mb-1 px-2 text-xs font-medium uppercase tracking-[0.06em] text-ink-3'

function Group({ title, entries, selected, onSelect }: Pick<Props, 'selected' | 'onSelect'> & { title: string; entries: ListEntry[] }) {
  return (
    <div>
      <p className={SECTION}>{title}</p>
      <ul className="grid gap-0.5">
        {entries.map((e) => (
          <li key={e.key}>
            <button type="button" onClick={() => onSelect(e.key)} aria-current={e.key === selected ? 'true' : undefined}
              className={cn(ITEM, e.key === selected && 'bg-hover font-medium text-ink')}>
              <span className="truncate">{e.name}</span>
              {e.count !== null && <span className="flex-none text-xs tabular-nums text-ink-3">{e.count}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Layout B: the lists in a column at 1080 px and up, a dropdown below it. */
export default function MarketLists({ market, mine, selected, onSelect, footer }: Props) {
  const all = [...market, ...mine]
  return (
    <>
      <nav aria-label="Listas" className="grid content-start gap-5 max-[1079px]:hidden">
        <Group title="Mercado" entries={market} selected={selected} onSelect={onSelect} />
        <div className="grid gap-1">
          <Group title="Mis listas" entries={mine} selected={selected} onSelect={onSelect} />
          {footer}
        </div>
      </nav>
      <div className="grid gap-2 min-[1080px]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="market-list" className={cn(labelCls, 'flex-none')}>Lista</label>
          <select id="market-list" className={cn(field, 'min-w-0 flex-1')} value={all.some((e) => e.key === selected) ? selected : ''}
            onChange={(e) => onSelect(e.target.value)}>
            {!all.some((e) => e.key === selected) && <option value="" disabled>Cargando…</option>}
            <optgroup label="Mercado">{market.map((e) => <option key={e.key} value={e.key}>{e.name}</option>)}</optgroup>
            <optgroup label="Mis listas">{mine.map((e) => <option key={e.key} value={e.key}>{e.name}{e.count !== null ? ` (${e.count})` : ''}</option>)}</optgroup>
          </select>
        </div>
        {footer}
      </div>
    </>
  )
}
