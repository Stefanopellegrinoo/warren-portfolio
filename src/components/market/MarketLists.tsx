'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NewList } from './ListControls'

export interface ListEntry { key: string; name: string; count: number | null }

interface Props {
  market: ListEntry[]
  mine: ListEntry[]
  selected: string
  onSelect: (key: string) => void
  onCreated: (id: string, name: string) => void
}

const SECTION = 'px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3'
const COUNT = 'flex-none font-mono text-[11px] tabular-nums'

function Group({ title, entries, selected, onSelect }: Pick<Props, 'selected' | 'onSelect'> & { title: string; entries: ListEntry[] }) {
  return (
    <div>
      <p className={SECTION}>{title}</p>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-px">
        {entries.map((e) => {
          const on = e.key === selected
          return (
            <li key={e.key}>
              <button type="button" onClick={() => onSelect(e.key)} aria-current={on ? 'true' : undefined}
                className={cn('flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm',
                  on ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-hover hover:text-ink')}>
                <span className="truncate">{e.name}</span>
                {e.count !== null && <span className={cn(COUNT, on ? 'text-accent-ink' : 'text-ink-3')}>{e.count}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** S11: a compact card panel at 1080 px and up; below it, pills that scroll sideways inside their row. */
export default function MarketLists({ market, mine, selected, onSelect, onCreated }: Props) {
  const [creating, setCreating] = useState(false)
  const all = [...market, ...mine]
  return (
    <>
      <nav aria-label="Listas" className="sticky top-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 rounded-lg border border-line bg-surface p-1.5 max-[1079px]:hidden">
        <Group title="Mercado" entries={market} selected={selected} onSelect={onSelect} />
        <hr className="mx-1 border-line" />
        <Group title="Mis listas" entries={mine} selected={selected} onSelect={onSelect} />
        <NewList onCreated={onCreated} />
      </nav>
      <div className="grid min-w-0 gap-2 min-[1080px]:hidden">
        <div role="group" aria-label="Elegí una lista" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {all.map((e) => {
            const on = e.key === selected
            return (
              <button key={e.key} type="button" aria-pressed={on} onClick={() => onSelect(e.key)}
                className={cn('flex h-11 flex-none items-center gap-1.5 rounded-full border px-3.5 text-[13.5px]',
                  on ? 'border-transparent bg-accent-soft font-medium text-accent-ink' : 'border-line bg-surface text-ink-2')}>
                {e.name}
                {e.count !== null && <span className={cn(COUNT, on ? 'text-accent-ink' : 'text-ink-3')}>{e.count}</span>}
              </button>
            )
          })}
          <button type="button" aria-label="Nueva lista" aria-expanded={creating} onClick={() => setCreating((c) => !c)}
            className="grid h-11 w-11 flex-none place-items-center rounded-full border border-line bg-surface text-ink-2">
            <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        {creating && <NewList formOnly onClose={() => setCreating(false)} onCreated={onCreated} />}
      </div>
    </>
  )
}
