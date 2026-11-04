'use client'

import { useState } from 'react'
import { Plus, Star } from 'lucide-react'
import { cachedValue, load, setCachedValue } from '@/lib/client-cache'
import { spellingsOf } from '@/lib/list-symbols'
import type { ViewRow } from '@/lib/market-view'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { InlineConfirm } from '@/components/ui/InlineConfirm'
import { btnPrimary, btnQuiet, field } from '@/components/ons/ui'
import { itemsKey, type WatchlistRow } from './keys'

// The same routes and bodies as Gráficos' list selector (components/trading/watchlist/WatchlistSelector.tsx).
async function send(url: string, method: string, body?: object): Promise<string | null> {
  try {
    const res = await fetch(url, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method })
    if (res.ok) return null
    const data = await res.json().catch(() => ({}))
    return typeof data?.error === 'string' ? data.error : 'No se pudo guardar. Probá de nuevo.'
  } catch {
    return 'Sin conexión. Probá de nuevo.'
  }
}

/** A list's stored symbols, read once and shared by every star and the page (symbols only, no prices). */
export const itemsOf = (id: string) => load(itemsKey(id), async () => {
  const res = await fetch(`/api/watchlist?watchlistId=${encodeURIComponent(id)}&fields=symbols`)
  if (!res.ok) throw new Error(String(res.status))
  return ((await res.json()) as { items: { symbol: string }[] }).items.map((i) => i.symbol)
})

/** The stored symbols of a list that mean this row's asset, as stored (removal deletes them exactly). */
function heldAs(row: ViewRow, stored: string[]): string[] {
  const spellings = row.line ? spellingsOf(row.line.kind, row.line.line) : [row.stored.toUpperCase()]
  return stored.filter((s) => spellings.includes(s.trim().toUpperCase()))
}

/** S4: add the row's asset to any of the user's lists, or take it out; the same lists as Gráficos. */
export function ListStar({ row, lists, held: page, onChanged, label = false }: {
  row: ViewRow
  lists: WatchlistRow[]
  /** What each of the user's lists holds, read once by the page, so a star is filled before it is opened. */
  held?: Record<string, string[]>
  onChanged: (listId: string, items: string[]) => void
  /** With its word ("Listas"), as in a phone row's actions. */
  label?: boolean
}) {
  const [held, setHeld] = useState<Record<string, string[]> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const known = (id: string) => held?.[id] ?? page?.[id] ?? cachedValue<string[]>(itemsKey(id))
  const inAny = lists.some((l) => heldAs(row, known(l.id) ?? []).length > 0)

  const open = async (isOpen: boolean) => {
    if (!isOpen) return
    setError(null)
    try {
      const all = await Promise.all(lists.map(async (l) => [l.id, await itemsOf(l.id)] as const))
      setHeld(Object.fromEntries(all))
    } catch {
      setError('No se pudieron leer tus listas.')
    }
  }

  const toggle = async (id: string) => {
    const stored = known(id) ?? []
    const mine = heldAs(row, stored)
    setBusy(true)
    let failed: string | null = null
    for (const s of mine.length ? mine : [null]) {
      failed = s === null
        ? await send('/api/watchlist', 'POST', { symbol: row.stored, watchlistId: id })
        : await send(`/api/watchlist?symbol=${encodeURIComponent(s)}&watchlistId=${encodeURIComponent(id)}`, 'DELETE')
      if (failed) break
    }
    setBusy(false)
    setError(failed)
    if (failed) return
    const next = mine.length ? stored.filter((s) => !mine.includes(s)) : [...stored, row.stored]
    setCachedValue(itemsKey(id), next)
    setHeld((h) => ({ ...h, [id]: next }))
    onChanged(id, next)
  }

  return (
    <Popover onOpenChange={open}>
      <PopoverTrigger aria-label={inAny ? `${row.ticker} está en tus listas: cambiar` : `Agregar ${row.ticker} a una lista`}
        className={cn('inline-flex items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink',
          label ? 'h-11 gap-1.5 border border-line bg-surface px-3 text-[13px] text-ink' : 'h-8 w-8 max-[1079px]:h-11 max-[1079px]:w-11')}>
        <Star className={cn('h-4 w-4', inAny && 'fill-current text-accent-ink')} strokeWidth={1.5} aria-hidden="true" />
        {label && <span aria-hidden="true">Listas</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <p className="px-2 pb-1 text-xs font-medium uppercase tracking-[0.06em] text-ink-3">Listas de {row.ticker}</p>
        {lists.length === 0 && <p className="px-2 py-1 text-[13px] text-ink-3">Todavía no tenés listas. Creá una con “Nueva lista”.</p>}
        {lists.map((l) => (
          <label key={l.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-hover max-[1079px]:min-h-11">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" disabled={busy || !held}
              checked={heldAs(row, known(l.id) ?? []).length > 0} onChange={() => toggle(l.id)} />
            {l.name}
          </label>
        ))}
        {error && <p role="alert" className="px-2 pt-1 text-[13px] text-danger">{error}</p>}
      </PopoverContent>
    </Popover>
  )
}

function NameForm({ initial = '', submit, onCancel, action }: {
  initial?: string
  submit: (name: string) => Promise<string | null>
  onCancel: () => void
  action: string
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form className="grid gap-2" onSubmit={async (e) => {
      e.preventDefault()
      if (!name.trim()) return
      setBusy(true)
      const failed = await submit(name.trim())
      setBusy(false)
      setError(failed)
    }}>
      <label className="sr-only" htmlFor={`list-name-${action}`}>Nombre de la lista</label>
      <input id={`list-name-${action}`} autoFocus maxLength={50} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la lista" className={field} />
      <span className="flex gap-2">
        <button type="submit" disabled={busy || !name.trim()} className={btnPrimary}>{action}</button>
        <button type="button" onClick={onCancel} className={btnQuiet}>Cancelar</button>
      </span>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </form>
  )
}

/** "Nueva lista": a button that opens its form, or (`formOnly`) the form alone, closed with `onClose`. */
export function NewList({ onCreated, formOnly = false, onClose = () => {} }: {
  onCreated: (id: string, name: string) => void
  formOnly?: boolean
  onClose?: () => void
}) {
  const [open, setOpen] = useState(formOnly)
  const close = () => { setOpen(false); onClose() }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn(btnQuiet, 'justify-start gap-1.5 px-2')}>
        <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Nueva lista
      </button>
    )
  }
  return (
    <NameForm action="Crear" onCancel={close} submit={async (name) => {
      try {
        const res = await fetch('/api/watchlist/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return typeof data?.error === 'string' ? data.error : 'No se pudo crear la lista.'
        close()
        onCreated(data.id, name)
        return null
      } catch {
        return 'Sin conexión. Probá de nuevo.'
      }
    }} />
  )
}

/** Rename or delete the list on screen; Cartera and the market's lists have neither. */
export function ListActions({ list, onChanged, onDeleted }: { list: WatchlistRow; onChanged: () => void; onDeleted: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (renaming) {
    return (
      <NameForm action="Guardar" initial={list.name} onCancel={() => setRenaming(false)} submit={async (name) => {
        const failed = await send(`/api/watchlist/lists/${encodeURIComponent(list.id)}`, 'PATCH', { name })
        if (!failed) { setRenaming(false); onChanged() }
        return failed
      }} />
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setRenaming(true)} className={btnQuiet}>Renombrar</button>
      <InlineConfirm question={`¿Eliminar la lista ${list.name}? También desaparece de Gráficos.`} confirmLabel="Eliminar" triggerClassName={btnQuiet}
        onConfirm={async () => {
          const failed = await send(`/api/watchlist/lists/${encodeURIComponent(list.id)}`, 'DELETE')
          setError(failed)
          if (!failed) onDeleted()
        }}>
        Eliminar lista
      </InlineConfirm>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  )
}
