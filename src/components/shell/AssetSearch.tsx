'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { searchAssets, type CatalogEntry } from '@/lib/asset-search'

type CatalogState = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; items: CatalogEntry[] }

export default function AssetSearch({ open, onClose, held }: { open: boolean; onClose: () => void; held: string[] }) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'idle' })

  const requested = useRef(false)

  const loadCatalog = useCallback(() => {
    fetch('/api/activos')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((items: CatalogEntry[]) => setCatalog({ status: 'ready', items }))
      .catch(() => setCatalog({ status: 'error' }))
  }, [])

  function retry() {
    setCatalog({ status: 'loading' })
    loadCatalog()
  }

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      // The catalog is fetched once, on the first open.
      if (!requested.current) { requested.current = true; loadCatalog() }
    }
    if (!open && d.open) d.close()
  }, [open, loadCatalog])

  const results = searchAssets(query, held, catalog.status === 'ready' ? catalog.items : [])

  // Every way of closing (Escape, backdrop, choosing) starts the next search fresh.
  function close() {
    setQuery('')
    setActive(0)
    onClose()
  }

  function choose(ticker: string) {
    close()
    router.push(`/trading?symbol=${encodeURIComponent(ticker)}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active].ticker) }
  }

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={e => { if (e.target === dialog.current) close() }}
      aria-labelledby="asset-search-label"
      className="mt-[12vh] w-[min(560px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/30"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search className="h-4 w-4 flex-none text-ink-3" strokeWidth={1.5} aria-hidden="true" />
        <label id="asset-search-label" htmlFor="asset-search-input" className="sr-only">Buscar activo</label>
        <input
          id="asset-search-input"
          autoFocus
          value={query}
          onChange={e => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
          placeholder="Buscar activo por ticker o nombre"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="asset-search-list"
          aria-activedescendant={results[active] ? `asset-opt-${results[active].ticker}` : undefined}
          autoComplete="off"
          className="h-12 w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>

      {catalog.status === 'error' && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-danger" role="alert">
          No se pudo cargar la lista de activos.
          <button type="button" onClick={retry} className="font-medium underline underline-offset-2">Reintentar</button>
        </div>
      )}

      <ul id="asset-search-list" role="listbox" aria-label="Resultados" className="max-h-[50vh] overflow-y-auto py-1">
        {results.map((r, i) => (
          <li
            key={r.ticker}
            id={`asset-opt-${r.ticker}`}
            role="option"
            aria-selected={i === active}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(r.ticker)}
            className={cn('flex min-h-11 cursor-pointer items-center gap-3 px-4 text-sm', i === active && 'bg-hover')}
          >
            <span className="w-14 font-semibold">{r.ticker}</span>
            <span className="flex-1 truncate text-ink-2">{r.name ?? ''}</span>
            {r.held && <span className="text-xs text-ink-3">En cartera</span>}
          </li>
        ))}
      </ul>

      {results.length === 0 && catalog.status !== 'error' && (
        <p className="px-4 pb-4 pt-2 text-sm text-ink-3">
          {catalog.status === 'loading' || (catalog.status === 'idle' && query.trim()) ? 'Cargando activos…' : query.trim() ? 'No hay activos que coincidan.' : 'Escribí un ticker o un nombre.'}
        </p>
      )}
    </dialog>
  )
}
