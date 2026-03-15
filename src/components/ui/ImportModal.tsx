'use client'

import { useState, useRef } from 'react'
import { X, Upload, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function ImportModal({ onClose, onSuccess }: Props) {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [replace, setReplace] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: number; details: string[] } | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) setFile(f)
    else setError('Solo se aceptan archivos .xlsx o .xls')
  }

  async function handleImport() {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/transactions/import?replace=${replace}`, {
        method: 'POST', body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      if (data.imported > 0) setTimeout(() => { onSuccess(); onClose() }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al importar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg glass rounded-2xl p-6 animate-slide-up border border-white/10">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-display font-700 text-lg">Importar Excel</h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">Columnas: FECHA · TICKER · OPERACIÓN · CANTIDAD · PRECIO · COMISIÓN</p>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 mb-4
            ${dragging ? 'border-amber/60 bg-amber/5' : file ? 'border-emerald/40 bg-emerald/5' : 'border-bg-500 hover:border-slate-500 bg-bg-700/50'}`}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <FileSpreadsheet className="w-8 h-8 text-emerald" />
              <p className="text-emerald font-display font-600 text-sm">{file.name}</p>
              <p className="text-xs text-slate-500 font-mono">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-slate-600" />
              <p className="text-slate-400 text-sm font-display">Arrastrá tu archivo o hacé click</p>
              <p className="text-xs text-slate-600 font-mono">.xlsx o .xls</p>
            </div>
          )}
        </div>

        {/* Replace toggle */}
        <label className="flex items-center gap-3 mb-4 cursor-pointer group">
          <div className={`w-9 h-5 rounded-full transition-colors duration-200 relative
            ${replace ? 'bg-amber' : 'bg-bg-500'}`}
            onClick={() => setReplace(r => !r)}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200
              ${replace ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <div>
            <span className="text-sm text-slate-300 font-display">Reemplazar todo</span>
            <p className="text-[11px] text-slate-600 font-mono">Borra todas las transacciones existentes antes de importar</p>
          </div>
        </label>

        {error && (
          <div className="flex items-center gap-2 text-rose text-xs font-mono bg-rose/10 rounded-lg px-3 py-2 border border-rose/20 mb-4">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="bg-emerald/10 border border-emerald/20 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-emerald" />
              <span className="text-emerald font-display font-600 text-sm">
                {result.imported} operaciones importadas
              </span>
            </div>
            {result.errors > 0 && (
              <p className="text-amber text-xs font-mono">{result.errors} errores omitidos</p>
            )}
          </div>
        )}

        <button onClick={handleImport} disabled={!file || loading}
          className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? <div className="w-4 h-4 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" /> : <Upload className="w-4 h-4" />}
          {loading ? 'Importando...' : 'Importar Transacciones'}
        </button>
      </div>
    </div>
  )
}
