'use client'

import { useState, useEffect } from 'react'
import { X, Plus, Search, AlertCircle, ChevronLeft, TrendingUp, DollarSign, Landmark, Banknote } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Operation, TransactionInput, Cedear, Activo, ONOperation, CashMovementType } from '@/types'

// ─────────────────────────────────────────────────────────
// Step 1: asset type selector
// ─────────────────────────────────────────────────────────
type AssetClass = 'ACCION' | 'CEDEAR' | 'ON' | 'CASH'

interface Props {
  onClose: () => void
  onSuccess: () => void
  initialData?: {
    assetClass: AssetClass
    ticker: string
    quantity: number
    price: number
  }
}

const ASSET_CLASSES: { id: AssetClass; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
  {
    id: 'CEDEAR',
    label: 'CEDEAR',
    desc: 'Certificados de depósito',
    icon: <TrendingUp className="w-5 h-5" />,
    color: 'bg-purple-500/15 text-purple-400 border-purple-500/40 hover:bg-purple-500/25',
  },
  {
    id: 'ON',
    label: 'Obligación Negociable',
    desc: 'Bonos corporativos USD',
    icon: <Landmark className="w-5 h-5" />,
    color: 'bg-amber/15 text-amber border-amber/40 hover:bg-amber/25',
  },
  {
    id: 'CASH',
    label: 'Cash USD',
    desc: 'Depósito o retiro de efectivo',
    icon: <Banknote className="w-5 h-5" />,
    color: 'bg-emerald/15 text-emerald border-emerald/40 hover:bg-emerald/25',
  },
]

// ─────────────────────────────────────────────────────────
// Form state types
// ─────────────────────────────────────────────────────────
const STOCK_OPS: Operation[] = ['COMPRA', 'VENTA', 'DIVIDENDO']
const ON_OPS: ONOperation[] = ['COMPRA', 'VENTA', 'CUPON']
const CASH_OPS: CashMovementType[] = ['DEPOSITO', 'RETIRO']

interface CedearFormData {
  date: string
  ticker: string
  cantidad: number
  precio: number
  moneda: 'ARS' | 'USD'
  comision: number
  notas: string
}

interface ONFormData {
  date: string
  ticker: string
  operation: ONOperation
  quantity: number
  price: number
  commission: number
  notes: string
}

interface CashFormData {
  date: string
  type: CashMovementType
  amount: number
  description: string
}

interface DollarRates {
  ccl: number
  mep: number
  loaded: boolean
  error: boolean
}

// ─────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────
export default function AddTransactionModal({ onClose, onSuccess, initialData }: Props) {
  // Step 1 / Step 2
  const [step, setStep] = useState<1 | 2>(initialData ? 2 : 1)
  const [assetClass, setAssetClass] = useState<AssetClass | null>(initialData?.assetClass ?? null)

  // Filter operations based on mode
  const filteredStockOps = initialData 
    ? STOCK_OPS.filter(op => op === 'VENTA')
    : STOCK_OPS.filter(op => op !== 'VENTA')

  const filteredOnOps = initialData
    ? ON_OPS.filter(op => op === 'VENTA')
    : ON_OPS.filter(op => op !== 'VENTA')

  // ── ACCION state ──
  const [stockOp, setStockOp] = useState<Operation>(initialData ? 'VENTA' : 'COMPRA')
  const [form, setForm] = useState<TransactionInput>({
    date: new Date().toISOString().split('T')[0],
    ticker: initialData?.assetClass === 'ACCION' ? initialData.ticker : '',
    operation: initialData ? 'VENTA' : 'COMPRA',
    quantity: initialData?.assetClass === 'ACCION' ? initialData.quantity : 0,
    price: initialData?.assetClass === 'ACCION' ? initialData.price : 0,
    commission: 0,
    notes: '',
  })
  const [activos, setActivos] = useState<Activo[]>([])
  const [activoSearch, setActivoSearch] = useState(initialData?.assetClass === 'ACCION' ? initialData.ticker : '')
  const [showActivoDropdown, setShowActivoDropdown] = useState(false)

  // ── CEDEAR state ──
  const [cedears, setCedears] = useState<Cedear[]>([])
  const [cedearForm, setCedearForm] = useState<CedearFormData>({
    date: new Date().toISOString().split('T')[0],
    ticker: initialData?.assetClass === 'CEDEAR' ? initialData.ticker : '',
    cantidad: initialData?.assetClass === 'CEDEAR' ? initialData.quantity : 0,
    precio: initialData?.assetClass === 'CEDEAR' ? initialData.price : 0,
    moneda: 'ARS',
    comision: 0,
    notas: '',
  })
  const [cedearSearch, setCedearSearch] = useState(initialData?.assetClass === 'CEDEAR' ? initialData.ticker : '')
  const [showCedearDropdown, setShowCedearDropdown] = useState(false)
  const [dollarRates, setDollarRates] = useState<DollarRates>({ ccl: 0, mep: 0, loaded: false, error: false })

  // ── ON state ──
  const [onForm, setOnForm] = useState<ONFormData>({
    date: new Date().toISOString().split('T')[0],
    ticker: initialData?.assetClass === 'ON' ? initialData.ticker : '',
    operation: initialData ? 'VENTA' : 'COMPRA',
    quantity: initialData?.assetClass === 'ON' ? initialData.quantity : 0,
    price: initialData?.assetClass === 'ON' ? initialData.price : 0,
    commission: 0,
    notes: '',
  })
  const [onSearch, setOnSearch] = useState(initialData?.assetClass === 'ON' ? initialData.ticker : '')
  const [onResults, setOnResults] = useState<{ ticker: string; name?: string; source: string }[]>([])
  const [showOnDropdown, setShowOnDropdown] = useState(false)
  const [onSearchLoading, setOnSearchLoading] = useState(false)

  // ── CASH state ──
  const [cashForm, setCashForm] = useState<CashFormData>({
    date: new Date().toISOString().split('T')[0],
    type: 'DEPOSITO',
    amount: 0,
    description: '',
  })

  // ── Shared state ──
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Fetch activos & cedears ──
  useEffect(() => {
    async function fetchData() {
      try {
        const [activosRes, cedearsRes] = await Promise.all([
          fetch('/api/activos'),
          fetch('/api/cedears'),
        ])
        if (activosRes.ok) setActivos(await activosRes.json())
        if (cedearsRes.ok) {
          const cedearsList = await cedearsRes.json()
          setCedears(cedearsList)

          // If we have initialData for a CEDEAR, adjust quantity based on ratio
          if (initialData?.assetClass === 'CEDEAR') {
            const found = cedearsList.find((c: any) => c.ticker === initialData.ticker)
            if (found && found.ratio) {
              setCedearForm(prev => ({
                ...prev,
                cantidad: initialData.quantity * found.ratio,
                // Price is a bit trickier because of currency, but as a baseline 
                // we show the price per CEDEAR in USD if they switch to USD
                precio: initialData.price / found.ratio
              }))
            }
          }
        }
      } catch (err) {
        console.error('Error fetching data:', err)
      }
    }
    fetchData()
  }, [initialData])

  // ── Fetch dollar rates when CEDEAR is selected ──
  useEffect(() => {
    if (assetClass === 'CEDEAR' && !dollarRates.loaded && !dollarRates.error) {
      const fetchDollarRates = async () => {
        try {
          const res = await fetch('https://dolarapi.com/v1/dolares')
          if (!res.ok) throw new Error('Failed to fetch')
          const dolares = await res.json()
          const cclData = dolares.find((d: { casa: string }) => d.casa === 'contadoconliqui')
          const mepData = dolares.find((d: { casa: string }) => d.casa === 'bolsa')
          if (cclData && mepData) {
            setDollarRates({ ccl: cclData.venta, mep: mepData.venta, loaded: true, error: false })
          } else {
            setDollarRates(prev => ({ ...prev, error: true }))
          }
        } catch {
          setDollarRates(prev => ({ ...prev, error: true }))
        }
      }
      fetchDollarRates()
    }
  }, [assetClass, dollarRates.loaded, dollarRates.error])

  // ── Search ONs when user types in ON search field ──
  useEffect(() => {
    if (assetClass !== 'ON' || onSearch.length < 2) {
      setOnResults([])
      return
    }

    const searchONs = async () => {
      setOnSearchLoading(true)
      try {
        const res = await fetch(`/api/ons/search?q=${encodeURIComponent(onSearch)}&limit=10`)
        if (res.ok) {
          const data = await res.json()
          setOnResults(data.results || [])
        } else {
          setOnResults([])
        }
      } catch (err) {
        console.error('Error searching ONs:', err)
        setOnResults([])
      } finally {
        setOnSearchLoading(false)
      }
    }

    const debounce = setTimeout(searchONs, 300)
    return () => clearTimeout(debounce)
  }, [onSearch, assetClass])

  // ── Derived CEDEAR values ──
  const filteredActivos = activos.filter(a =>
    a.ticker.toLowerCase().includes(activoSearch.toLowerCase()) ||
    a.nombre.toLowerCase().includes(activoSearch.toLowerCase())
  )
  const filteredCedears = cedears.filter(c =>
    c.ticker.toLowerCase().includes(cedearSearch.toLowerCase()) ||
    c.nombre.toLowerCase().includes(cedearSearch.toLowerCase())
  )
  const selectedCedear = cedears.find(c => c.ticker === cedearForm.ticker)
  const cantidadAcciones = selectedCedear ? cedearForm.cantidad / selectedCedear.ratio : 0
  let precioAccionUSD = 0
  if (selectedCedear && dollarRates.loaded) {
    if (cedearForm.moneda === 'ARS') {
      precioAccionUSD = (cedearForm.precio * selectedCedear.ratio) / dollarRates.ccl
    } else {
      precioAccionUSD = (cedearForm.precio * dollarRates.mep * selectedCedear.ratio) / dollarRates.ccl
    }
  }

  // ── Derived values for rendering ──
  const commissionUSD = cedearForm.moneda === 'ARS' && dollarRates.loaded 
    ? cedearForm.comision / dollarRates.ccl 
    : cedearForm.comision

  const totalUSD = stockOp === 'VENTA'
    ? (cantidadAcciones * precioAccionUSD) - (commissionUSD || 0)
    : (cantidadAcciones * precioAccionUSD) + (commissionUSD || 0)

  // ── Submit handlers ──
  async function handleSubmitAccion(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.ticker.trim()) { setError('Ingresá el ticker'); return }
    if (form.quantity <= 0) { setError('La cantidad debe ser mayor a 0'); return }
    if (form.price <= 0 && stockOp !== 'DIVIDENDO') { setError('El precio debe ser mayor a 0'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, operation: stockOp, ticker: form.ticker.toUpperCase().trim(), assetType: 'ACCION', moneda: 'USD' }),
      })
      if (!res.ok) {
        let errStr = 'Error al guardar la operación'
        try { const d = await res.json(); if (d.error) errStr = d.error } catch { errStr = await res.text() || errStr }
        throw new Error(errStr)
      }
      onSuccess(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitCedear(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!cedearForm.ticker) { setError('Seleccioná un CEDEAR'); return }
    if (cedearForm.cantidad <= 0) { setError('La cantidad debe ser mayor a 0'); return }
    if (cedearForm.precio <= 0) { setError('El precio debe ser mayor a 0'); return }

    const commissionUSD = cedearForm.moneda === 'ARS' && dollarRates.loaded 
      ? cedearForm.comision / dollarRates.ccl 
      : cedearForm.comision

    setLoading(true)
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: cedearForm.ticker,
          quantity: cantidadAcciones,
          price: precioAccionUSD,
          moneda: cedearForm.moneda,
          operation: stockOp,
          date: cedearForm.date,
          commission: commissionUSD || 0,
          notes: cedearForm.notas || '',
          assetType: 'CEDEAR',
        }),
      })
      if (!res.ok) {
        let errStr = 'Error al guardar la operación'
        try { const d = await res.json(); if (d.error) errStr = d.error } catch { errStr = await res.text() || errStr }
        throw new Error(errStr)
      }
      onSuccess(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitON(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!onForm.ticker.trim()) { setError('Ingresá el ticker de la ON'); return }
    if (onForm.operation !== 'CUPON' && onForm.quantity <= 0) { setError('La cantidad debe ser mayor a 0'); return }
    if (onForm.price <= 0) { setError('El precio debe ser mayor a 0'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/on-positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...onForm, ticker: onForm.ticker.toUpperCase().trim() }),
      })
      if (!res.ok) {
        let errStr = 'Error al guardar la operación'
        try { const d = await res.json(); if (d.error) errStr = d.error } catch { errStr = await res.text() || errStr }
        throw new Error(errStr)
      }
      onSuccess(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitCash(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (cashForm.amount <= 0) { setError('El monto debe ser mayor a 0'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cashForm),
      })
      if (!res.ok) {
        let errStr = 'Error al guardar la operación'
        try { const d = await res.json(); if (d.error) errStr = d.error } catch { errStr = await res.text() || errStr }
        throw new Error(errStr)
      }
      onSuccess(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md glass rounded-2xl p-4 md:p-6 animate-slide-up border border-white/10 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button onClick={() => { setStep(1); setError('') }} className="text-slate-500 hover:text-white transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 className="font-display font-700 text-lg text-white">
                {step === 1 ? 'Nueva Operación' : initialData ? `Vender ${initialData.ticker}` : assetClass === 'CASH' ? 'Movimiento de Cash' : `Operación ${assetClass}`}
              </h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                {step === 1 ? 'Elegí el tipo de activo' : initialData ? 'Confirmá los datos de la venta' : 'Completá los datos'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── STEP 1: Asset Type Selector ── */}
        {step === 1 && (
          <div className="grid grid-cols-2 gap-3">
            {ASSET_CLASSES.map(ac => (
              <button
                key={ac.id}
                onClick={() => { setAssetClass(ac.id); setStep(2); setError('') }}
                className={cn(
                  'flex flex-col items-start gap-2 p-4 rounded-xl border transition-all duration-150 text-left',
                  ac.color
                )}
              >
                {ac.icon}
                <div>
                  <p className="text-sm font-display font-700">{ac.label}</p>
                  <p className="text-[10px] font-mono opacity-70 mt-0.5">{ac.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── STEP 2: Forms ── */}
        {step === 2 && assetClass === 'ACCION' && (
          <form onSubmit={handleSubmitAccion} className="space-y-4">
            {/* Operation tabs */}
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Operación</label>
              <div className={cn("grid gap-1.5", filteredStockOps.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {filteredStockOps.map(op => (
                  <button key={op} type="button" 
                    onClick={() => setStockOp(op)}
                    className={cn('py-2 rounded-lg text-xs font-display font-600 transition-all duration-150 border',
                      stockOp === op
                        ? op === 'COMPRA' ? 'bg-emerald/20 text-emerald border-emerald/40'
                          : op === 'VENTA' ? 'bg-rose/20 text-rose border-rose/40'
                          : 'bg-amber/20 text-amber border-amber/40'
                        : 'bg-bg-700 text-slate-500 border-bg-500 hover:border-slate-500')}>
                    {op}
                  </button>
                ))}
              </div>
            </div>

            {initialData && (
              <div className="bg-bg-700/50 border border-white/5 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-tighter">Posición Actual</p>
                  <p className="text-sm font-mono font-600 text-white">{initialData.quantity.toLocaleString()} acciones</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-tighter">Precio Mercado</p>
                  <p className="text-sm font-mono font-600 text-emerald">${initialData.price.toLocaleString()}</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Fecha</label>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input-field w-full" required />
              </div>
              <div className="relative">
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Ticker</label>
                <div className="relative">
                  <input type="text" placeholder="Buscar acción..." value={activoSearch}
                    onChange={e => { setActivoSearch(e.target.value); setShowActivoDropdown(true) }}
                    onFocus={() => setShowActivoDropdown(true)}
                    className="input-field w-full pr-8" required />
                  <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                </div>
                {showActivoDropdown && filteredActivos.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-bg-800 border border-bg-500 rounded-lg max-h-48 overflow-y-auto">
                    {filteredActivos.slice(0, 10).map(a => (
                      <button key={a.ticker} type="button"
                        onClick={() => { setForm(f => ({ ...f, ticker: a.ticker })); setActivoSearch(`${a.ticker} - ${a.nombre}`); setShowActivoDropdown(false) }}
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-bg-700 border-b border-bg-600 last:border-0">
                        <span className="font-mono text-blue-400">{a.ticker}</span>
                        <span className="text-slate-500 ml-2">{a.nombre}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Cantidad</label>
                <input type="number" min="0" step="any" placeholder="10" value={form.quantity || ''}
                  onChange={e => setForm(f => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))}
                  className="input-field w-full" required />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Precio USD</label>
                <input type="number" min="0" step="any" placeholder="190.70" value={form.price || ''}
                  onChange={e => setForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                  className="input-field w-full" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Comisión</label>
                <input type="number" min="0" step="any" placeholder="0" value={form.commission || ''}
                  onChange={e => setForm(f => ({ ...f, commission: parseFloat(e.target.value) || 0 }))}
                  className="input-field w-full" />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Notas</label>
                <input type="text" placeholder="Opcional" value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="input-field w-full" />
              </div>
            </div>
            {form.quantity > 0 && form.price > 0 && (
              <div className="bg-bg-700 rounded-lg px-4 py-3 flex justify-between items-center">
                <span className="text-xs text-slate-500 font-mono">
                  {stockOp === 'VENTA' ? 'Total a recibir' : 'Total estimado'}
                </span>
                <span className={cn("font-mono font-600", stockOp === 'VENTA' ? "text-rose" : "text-amber")}>
                  ${(stockOp === 'VENTA' 
                    ? (form.quantity * form.price) - (form.commission ?? 0)
                    : (form.quantity * form.price) + (form.commission ?? 0)
                  ).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            {error && <p className="text-rose text-xs font-mono bg-rose/10 rounded-lg px-3 py-2 border border-rose/20">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 py-2.5">
              {loading ? <div className="w-4 h-4 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
              {loading ? 'Guardando...' : initialData ? 'Confirmar Venta' : 'Guardar Operación'}
            </button>

          </form>
        )}

        {step === 2 && assetClass === 'CEDEAR' && (
          <form onSubmit={handleSubmitCedear} className="space-y-4">
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Operación</label>
              <div className={cn("grid gap-1.5", filteredStockOps.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {filteredStockOps.map(op => (
                  <button key={op} type="button" 
                    onClick={() => setStockOp(op)}
                    className={cn('py-2 rounded-lg text-xs font-display font-600 transition-all duration-150 border',
                      stockOp === op
                        ? op === 'COMPRA' ? 'bg-emerald/20 text-emerald border-emerald/40'
                          : op === 'VENTA' ? 'bg-rose/20 text-rose border-rose/40'
                          : 'bg-amber/20 text-amber border-amber/40'
                        : 'bg-bg-700 text-slate-500 border-bg-500 hover:border-slate-500')}>
                    {op}
                  </button>
                ))}
              </div>
            </div>

            {initialData && (
              <div className="bg-bg-700/50 border border-white/5 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-tighter">Tenencia Actual</p>
                  <p className="text-sm font-mono font-600 text-white">{initialData.quantity.toLocaleString()} CEDEARs</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-tighter">Precio Mercado</p>
                  <p className="text-sm font-mono font-600 text-emerald">${initialData.price.toLocaleString()}</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Fecha</label>
                <input type="date" value={cedearForm.date} onChange={e => setCedearForm(f => ({ ...f, date: e.target.value }))} className="input-field w-full" required />
              </div>
              <div className="relative">
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">CEDEAR</label>
                <div className="relative">
                  <input type="text" placeholder="Buscar CEDEAR..." value={cedearSearch}
                    onChange={e => { setCedearSearch(e.target.value); setShowCedearDropdown(true) }}
                    onFocus={() => setShowCedearDropdown(true)}
                    className="input-field w-full pr-8" required />
                  <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                </div>
                {showCedearDropdown && filteredCedears.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-bg-800 border border-bg-500 rounded-lg max-h-48 overflow-y-auto">
                    {filteredCedears.map(c => (
                      <button key={c.ticker} type="button"
                        onClick={() => { setCedearForm(f => ({ ...f, ticker: c.ticker })); setCedearSearch(`${c.ticker} - ${c.nombre}`); setShowCedearDropdown(false) }}
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-bg-700 border-b border-bg-600 last:border-0">
                        <span className="font-mono text-purple-400">{c.ticker}</span>
                        <span className="text-slate-500 ml-2">{c.nombre}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Cantidad (CEDEARs)</label>
                <input type="number" min="0" step="any" placeholder="10" value={cedearForm.cantidad || ''}
                  onChange={e => setCedearForm(f => ({ ...f, cantidad: parseFloat(e.target.value) || 0 }))}
                  className="input-field w-full" required />
                {selectedCedear && cedearForm.cantidad > 0 && (
                  <p className="text-xs text-slate-500 mt-1">= {cantidadAcciones.toFixed(4)} acciones</p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Precio</label>
                <input type="number" min="0" step="any" placeholder="190.70" value={cedearForm.precio || ''}
                  onChange={e => setCedearForm(f => ({ ...f, precio: parseFloat(e.target.value) || 0 }))}
                  className="input-field w-full" required />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Moneda</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['ARS', 'USD'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setCedearForm(f => ({ ...f, moneda: m }))}
                    className={cn('py-2 rounded-lg text-xs font-display font-600 transition-all duration-150 border',
                      cedearForm.moneda === m
                        ? m === 'ARS' ? 'bg-emerald/20 text-emerald border-emerald/40' : 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                        : 'bg-bg-700 text-slate-500 border-bg-500 hover:border-slate-500')}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Comisión</label>
                <input type="number" min="0" step="any" placeholder="0" value={cedearForm.comision || ''}
                  onChange={e => setCedearForm(f => ({ ...f, comision: parseFloat(e.target.value) || 0 }))}
                  className="input-field w-full" />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Notas</label>
                <input type="text" placeholder="Opcional" value={cedearForm.notas}
                  onChange={e => setCedearForm(f => ({ ...f, notas: e.target.value }))}
                  className="input-field w-full" />
              </div>
            </div>
            {selectedCedear && dollarRates.loaded && cedearForm.cantidad > 0 && cedearForm.precio > 0 && (
              <div className="bg-bg-700 rounded-lg px-4 py-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-mono">Ratio</span>
                  <span className="text-slate-300 font-mono">{selectedCedear.ratio}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-mono">CCL</span>
                  <span className="text-slate-300 font-mono">${dollarRates.ccl.toFixed(2)}</span>
                </div>
                <div className="border-t border-bg-500 pt-2 mt-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-slate-500 font-mono">Precio acción</span>
                    <span className="font-mono font-600 text-purple-400">${precioAccionUSD.toFixed(2)} USD</span>
                  </div>
                </div>
              </div>
            )}
            {cedearForm.cantidad > 0 && cedearForm.precio > 0 && (
              <div className="bg-bg-700 rounded-lg px-4 py-3 flex justify-between items-center">
                <span className="text-xs text-slate-500 font-mono">
                  {stockOp === 'VENTA' ? 'Recibir en Portfolio (USD)' : 'Inversión en Portfolio (USD)'}
                </span>
                <span className={cn("font-mono font-600", stockOp === 'VENTA' ? "text-rose" : "text-amber")}>
                  ${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                </span>
              </div>
            )}
            {dollarRates.error && (
              <div className="bg-rose/10 rounded-lg px-4 py-3 flex items-center gap-2 border border-rose/20">
                <AlertCircle className="w-4 h-4 text-rose" />
                <span className="text-xs text-rose">No se pudo obtener cotización CCL/MEP.</span>
              </div>
            )}
            {error && <p className="text-rose text-xs font-mono bg-rose/10 rounded-lg px-3 py-2 border border-rose/20">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 py-2.5">
              {loading ? <div className="w-4 h-4 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
              {loading ? 'Guardando...' : initialData ? 'Confirmar Venta' : 'Guardar Operación'}
            </button>

          </form>
        )}

        {step === 2 && assetClass === 'ON' && (
          <form onSubmit={handleSubmitON} className="space-y-4">
            {/* ON Operation tabs */}
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Operación</label>
              <div className={cn("grid gap-1.5", filteredOnOps.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {filteredOnOps.map(op => (
                  <button key={op} type="button" 
                    onClick={() => setOnForm(f => ({ ...f, operation: op }))}
                    className={cn('py-2 rounded-lg text-xs font-display font-600 transition-all duration-150 border',
                      onForm.operation === op
                        ? op === 'COMPRA' ? 'bg-emerald/20 text-emerald border-emerald/40'
                          : op === 'VENTA' ? 'bg-rose/20 text-rose border-rose/40'
                          : 'bg-amber/20 text-amber border-amber/40'
                        : 'bg-bg-700 text-slate-500 border-bg-500 hover:border-slate-500')}>
                    {op}
                  </button>
                ))}
              </div>
            </div>

            {initialData && (
              <div className="bg-bg-700/50 border border-white/5 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-tighter">Nominales Actuales</p>
                  <p className="text-sm font-mono font-600 text-white">{initialData.quantity.toLocaleString()} nominales</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-tighter">Precio Mercado</p>
                  <p className="text-sm font-mono font-600 text-emerald">${initialData.price.toLocaleString()}</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Fecha</label>
                <input type="date" value={onForm.date} onChange={e => setOnForm(f => ({ ...f, date: e.target.value }))} className="input-field w-full" required />
              </div>
              <div className="relative">
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Ticker ON</label>
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Buscar ON..." 
                    value={onSearch}
                    onChange={e => { setOnSearch(e.target.value.toUpperCase()); setShowOnDropdown(true) }}
                    onFocus={() => setShowOnDropdown(true)}
                    className="input-field w-full pr-8 font-mono" 
                    required 
                  />
                  <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                </div>
                {showOnDropdown && onResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-bg-800 border border-bg-500 rounded-lg max-h-48 overflow-y-auto">
                    {onResults.map((on) => (
                      <button 
                        key={on.ticker} 
                        type="button"
                        onClick={() => { 
                          setOnForm(f => ({ ...f, ticker: on.ticker })); 
                          setOnSearch(on.ticker); 
                          setShowOnDropdown(false) 
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-bg-700 border-b border-bg-600 last:border-0"
                      >
                        <span className="font-mono text-amber">{on.ticker}</span>
                        {on.name && <span className="text-slate-500 ml-2">{on.name}</span>}
                        <span className="text-[10px] text-slate-600 ml-2">({on.source})</span>
                      </button>
                    ))}
                  </div>
                )}
                {showOnDropdown && onSearchLoading && (
                  <div className="absolute z-10 w-full mt-1 bg-bg-800 border border-bg-500 rounded-lg px-3 py-2">
                    <span className="text-xs text-slate-500">Buscando...</span>
                  </div>
                )}
                {showOnDropdown && !onSearchLoading && onSearch.length >= 2 && onResults.length === 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-bg-800 border border-bg-500 rounded-lg px-3 py-2">
                    <span className="text-xs text-slate-500">No se encontraron ONs</span>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">
                  {onForm.operation === 'CUPON' ? 'Monto cupón (USD)' : 'Cantidad (nominales / 100)'}
                </label>
                <input type="number" min="0" step="any" placeholder={onForm.operation === 'CUPON' ? '500' : '200'}
                  value={onForm.quantity || ''}
                  onChange={e => setOnForm(f => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))}
                  className="input-field w-full" required />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">
                  {onForm.operation === 'CUPON' ? 'Precio unitario' : 'Precio (× 100)'}
                </label>
                <input type="number" min="0" step="any"
                  placeholder={onForm.operation === 'CUPON' ? '1' : '100'}
                  value={onForm.price || ''}
                  onChange={e => setOnForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                  className="input-field w-full" required />
              </div>
            </div>
            {onForm.operation !== 'CUPON' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Comisión</label>
                  <input type="number" min="0" step="any" placeholder="0" value={onForm.commission || ''}
                    onChange={e => setOnForm(f => ({ ...f, commission: parseFloat(e.target.value) || 0 }))}
                    className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Notas</label>
                  <input type="text" placeholder="Opcional" value={onForm.notes}
                    onChange={e => setOnForm(f => ({ ...f, notes: e.target.value }))}
                    className="input-field w-full" />
                </div>
              </div>
            )}
            {onForm.quantity > 0 && onForm.price > 0 && (
              <div className="bg-bg-700 rounded-lg px-4 py-3 flex justify-between items-center">
                <span className="text-xs text-slate-500 font-mono">
                  {onForm.operation === 'CUPON' ? 'Monto cupón' : onForm.operation === 'VENTA' ? 'Total a recibir' : 'Total estimado'}
                </span>
                <span className={cn("font-mono font-600", onForm.operation === 'VENTA' ? "text-rose" : "text-amber")}>
                  ${(onForm.operation === 'VENTA' 
                    ? (onForm.quantity * onForm.price) - (onForm.commission ?? 0)
                    : (onForm.quantity * onForm.price) + (onForm.commission ?? 0)
                  ).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                </span>
              </div>
            )}
            {error && <p className="text-rose text-xs font-mono bg-rose/10 rounded-lg px-3 py-2 border border-rose/20">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 py-2.5">
              {loading ? <div className="w-4 h-4 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
              {loading ? 'Guardando...' : initialData ? 'Confirmar Venta' : 'Guardar Operación'}
            </button>

          </form>
        )}

        {step === 2 && assetClass === 'CASH' && (
          <form onSubmit={handleSubmitCash} className="space-y-4">
            {/* DEPOSITO / RETIRO */}
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Tipo de movimiento</label>
              <div className="grid grid-cols-2 gap-1.5">
                {CASH_OPS.map(op => (
                  <button key={op} type="button" onClick={() => setCashForm(f => ({ ...f, type: op }))}
                    className={cn('py-2.5 rounded-lg text-xs font-display font-700 transition-all duration-150 border',
                      cashForm.type === op
                        ? op === 'DEPOSITO' ? 'bg-emerald/20 text-emerald border-emerald/40'
                          : 'bg-rose/20 text-rose border-rose/40'
                        : 'bg-bg-700 text-slate-500 border-bg-500 hover:border-slate-500')}>
                    {op === 'DEPOSITO' ? '↑ DEPÓSITO' : '↓ RETIRO'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Fecha</label>
                <input type="date" value={cashForm.date} onChange={e => setCashForm(f => ({ ...f, date: e.target.value }))} className="input-field w-full" required />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Monto USD</label>
                <input type="number" min="0" step="any" placeholder="1000" value={cashForm.amount || ''}
                  onChange={e => setCashForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                  className="input-field w-full" required />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Descripción</label>
              <input type="text" placeholder="Ej: Transferencia desde banco, cobro dividendo..." value={cashForm.description}
                onChange={e => setCashForm(f => ({ ...f, description: e.target.value }))}
                className="input-field w-full" />
            </div>
            {cashForm.amount > 0 && (
              <div className={cn('rounded-lg px-4 py-3 flex justify-between items-center',
                cashForm.type === 'DEPOSITO' ? 'bg-emerald/10 border border-emerald/20' : 'bg-rose/10 border border-rose/20'
              )}>
                <span className="text-xs font-mono text-slate-400">
                  {cashForm.type === 'DEPOSITO' ? 'Saldo aumentará' : 'Saldo disminuirá'}
                </span>
                <span className={cn('font-mono font-700', cashForm.type === 'DEPOSITO' ? 'text-emerald' : 'text-rose')}>
                  {cashForm.type === 'DEPOSITO' ? '+' : '-'}${cashForm.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            {error && <p className="text-rose text-xs font-mono bg-rose/10 rounded-lg px-3 py-2 border border-rose/20">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 py-2.5">
              {loading ? <div className="w-4 h-4 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
              {loading ? 'Guardando...' : initialData ? 'Confirmar Venta' : 'Guardar Operación'}
            </button>

          </form>
        )}

      </div>
    </div>
  )
}
