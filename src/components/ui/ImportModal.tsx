'use client'

import { useState, useRef } from 'react'
import { X, Upload, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function ImportModal({ onClose, onSuccess }: Props) {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [replace, setReplace] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
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

    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/transactions/import?replace=${replace}`, {
        method: 'POST', body: fd,
      })
      const data = await res.json()
      
      if (!res.ok) {
        // Handle Excel validation errors (fail-fast from parser)
        if (data.details && data.details.line) {
          toast.error('❌ Error en archivo Excel', {
            description: `${data.details.message}`,
          })
          setLoading(false)
          return
        }
        throw new Error(data.error)
      }

      const jobId = data.jobId
      if (!jobId) throw new Error('No se recibió ID de proceso')

      // Close modal immediately
      onClose()

      // Create loading toast
      const toastId = `import-progress-${jobId}`
      toast.loading('📤 Importando transacciones...', {
        id: toastId,
        description: '0% · Iniciando proceso',
        duration: Infinity,
      })

      // Poll status
      let lastValidResult: any = null
      const interval = setInterval(async () => {
        try {
          const sRes = await fetch(`/api/transactions/import/status?jobId=${jobId}`)
          const sData = await sRes.json()
          
          if (!sRes.ok) {
            clearInterval(interval)
            toast.error('❌ Error en importación', {
              id: toastId,
              description: sData.error,
            })
            setLoading(false)
            return
          }

          // Update progress in toast if available
          if (sData.progress) {
            toast.loading(sData.progress.message || 'Procesando...', {
              id: toastId,
              description: `${sData.progress.percentage}% · ${sData.progress.message || ''}`,
            })
          }

          // Save valid result (including when completed, before BullMQ cleans it)
          if (sData.result && sData.result.imported !== undefined && sData.result.imported > 0) {
            lastValidResult = sData.result
          }

          if (sData.state === 'completed') {
            clearInterval(interval)
            // Use last valid result if job was cleaned up (imported = 0 and no errors means cleaned)
            const finalResult = (sData.result.imported === 0 && !sData.result.errors?.length && lastValidResult) 
              ? lastValidResult 
              : sData.result
            
            if (finalResult.success && finalResult.imported > 0) {
              toast.success(`✅ ¡Importación completada!`, {
                id: toastId,
                description: `${finalResult.imported} transacción${finalResult.imported > 1 ? 'es' : ''} importada${finalResult.imported > 1 ? 's' : ''} correctamente`,
                duration: 5000,
              })
              // Wait for price caching and position rebuild to complete (worker has 2sec delay)
              setTimeout(() => {
                onSuccess()
              }, 2500)
            } else if (!finalResult.success) {
              toast.error(`❌ Importación falló`, {
                id: toastId,
                description: `${finalResult.failed} error${finalResult.failed > 1 ? 'es' : ''}. Ninguna transacción importada (rollback automático).`,
                duration: 5000,
              })
            } else {
              toast.info(`ℹ️ Importación completada`, {
                id: toastId,
                description: 'No se importaron transacciones nuevas',
                duration: 3000,
              })
            }
            setLoading(false)
          } else if (sData.state === 'failed') {
            clearInterval(interval)
            // Parse failed result to extract error details
            const failedResult = sData.result || {}
            const errorCount = failedResult.errors?.length || 0
            
            if (errorCount > 0) {
              const errorDetails = failedResult.errors?.map((err: any) => 
                `Línea ${err.line}: ${err.error}${err.ticker && err.ticker !== 'UNKNOWN' ? ` · ${err.ticker}` : ''}`
              ).join('\n')
              
              toast.error('❌ Error en importación', {
                id: toastId,
                description: `${errorCount} error${errorCount > 1 ? 'es' : ''} encontrado${errorCount > 1 ? 's' : ''}. Ninguna transacción fue importada (rollback automático).\n\n${errorDetails}`,
              })
            } else {
              toast.error('❌ Error en importación', {
                id: toastId,
                description: sData.result?.message || 'Error desconocido',
              })
            }
            setLoading(false)
          }
        } catch (err) {
          clearInterval(interval)
          const errorMessage = err instanceof Error ? err.message : 'Error al consultar estado'
          toast.error('❌ Error en importación', {
            id: toastId,
            description: errorMessage,
          })
          setLoading(false)
        }
      }, 1000)

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error al iniciar importación'
      toast.error('❌ Error en importación', {
        description: errorMessage,
      })
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg glass rounded-2xl p-4 md:p-6 animate-slide-up border border-white/10">

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

        <button onClick={handleImport} disabled={!file || loading}
          className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? <div className="w-4 h-4 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" /> : <Upload className="w-4 h-4" />}
          {loading ? 'Importando...' : 'Importar Transacciones'}
        </button>
      </div>
    </div>
  )
}
