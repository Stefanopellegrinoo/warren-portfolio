'use client'

import { useState, useRef, useEffect } from 'react'
import { formatNumber } from '@/lib/utils'
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
  const dialog = useRef<HTMLDialogElement>(null)

  // Native modal dialog: focus trap, Escape and top layer come from the browser.
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) { setFile(f); setError(null) }
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
        if (data.details && data.details.line) {
          toast.error('Error en archivo Excel', {
            description: `${data.details.message}`,
          })
          setLoading(false)
          return
        }
        throw new Error(data.error)
      }

      const jobId = data.jobId
      if (!jobId) throw new Error('No se recibió ID de proceso')

      onClose()

      const toastId = `import-progress-${jobId}`
      toast.loading('Importando transacciones...', {
        id: toastId,
        description: '0% · Iniciando proceso',
        duration: Infinity,
      })

      let lastValidResult: any = null
      const interval = setInterval(async () => {
        try {
          const sRes = await fetch(`/api/transactions/import/status?jobId=${jobId}`)
          const sData = await sRes.json()
          
          if (!sRes.ok) {
            clearInterval(interval)
            toast.error('Error en la importación', {
              id: toastId,
              description: sData.error,
            })
            setLoading(false)
            return
          }

          if (sData.progress) {
            toast.loading(sData.progress.message || 'Procesando...', {
              id: toastId,
              description: `${sData.progress.percentage}% · ${sData.progress.message || ''}`,
            })
          }

          if (sData.result && sData.result.imported !== undefined && sData.result.imported > 0) {
            lastValidResult = sData.result
          }

          if (sData.state === 'completed') {
            clearInterval(interval)
            const finalResult = (sData.result.imported === 0 && !sData.result.errors?.length && lastValidResult) 
              ? lastValidResult 
              : sData.result
            
            if (finalResult.success && finalResult.imported > 0) {
              toast.success(`Importación completada`, {
                id: toastId,
                description: `${finalResult.imported} transacción${finalResult.imported > 1 ? 'es' : ''} importada${finalResult.imported > 1 ? 's' : ''} correctamente`,
                duration: 5000,
              })
              setTimeout(() => {
                onSuccess()
              }, 2500)
            } else if (!finalResult.success) {
              toast.error(`Importación falló`, {
                id: toastId,
                description: `${finalResult.failed} error${finalResult.failed > 1 ? 'es' : ''}. Ninguna transacción importada (rollback automático).`,
                duration: 5000,
              })
            } else {
              toast.info(`Importación completada`, {
                id: toastId,
                description: 'No se importaron transacciones nuevas',
                duration: 3000,
              })
            }
            setLoading(false)
          } else if (sData.state === 'failed') {
            clearInterval(interval)
            const failedResult = sData.result || {}
            const errorCount = failedResult.errors?.length || 0
            
            if (errorCount > 0) {
              const errorDetails = failedResult.errors?.map((err: any) => 
                `Línea ${err.line}: ${err.error}${err.ticker && err.ticker !== 'UNKNOWN' ? ` · ${err.ticker}` : ''}`
              ).join('\n')
              
              toast.error('Error en la importación', {
                id: toastId,
                description: `${errorCount} error${errorCount > 1 ? 'es' : ''} encontrado${errorCount > 1 ? 's' : ''}. Ninguna transacción fue importada (rollback automático).\n\n${errorDetails}`,
              })
            } else {
              toast.error('Error en la importación', {
                id: toastId,
                description: sData.result?.message || 'Error desconocido',
              })
            }
            setLoading(false)
          }
        } catch (err) {
          clearInterval(interval)
          const errorMessage = err instanceof Error ? err.message : 'Error al consultar estado'
          toast.error('Error en la importación', {
            id: toastId,
            description: errorMessage,
          })
          setLoading(false)
        }
      }, 1000)

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error al iniciar importación'
      toast.error('Error en la importación', {
        description: errorMessage,
      })
      setLoading(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      aria-labelledby="import-title"
      className="w-[min(480px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/30"
    >
      <div className="grid gap-4 p-6 max-[819px]:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="import-title" className="font-serif text-2xl">Importar operaciones</h2>
            <p className="mt-1 text-[13px] text-ink-3">
              Un archivo Excel con las columnas FECHA, TICKER, OPERACIÓN, CANTIDAD, PRECIO y COMISIÓN.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-11 max-[819px]:w-11">
            <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <label
          htmlFor="import-file"
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`grid cursor-pointer justify-items-center gap-1.5 rounded-md border border-dashed px-4 py-8 text-center has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring
            ${dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2 hover:border-ink-3'}`}
        >
          <input id="import-file" type="file" accept=".xlsx,.xls" className="sr-only"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setError(null) }} />
          {file ? (
            <>
              <FileSpreadsheet className="h-7 w-7 text-accent-ink" strokeWidth={1.5} aria-hidden="true" />
              <span className="font-medium">{file.name}</span>
              <span className="text-[13px] text-ink-3 tabular-nums">{formatNumber(file.size / 1024, { decimals: 1 })} KB</span>
            </>
          ) : (
            <>
              <Upload className="h-7 w-7 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
              <span className="font-medium">Arrastrá tu archivo o elegilo</span>
              <span className="text-[13px] text-ink-3">.xlsx o .xls</span>
            </>
          )}
        </label>

        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3">
          <input id="import-replace" type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} aria-describedby="import-replace-hint"
            className="mt-0.5 h-5 w-5 cursor-pointer accent-[var(--accent)]" />
          <div>
            <label htmlFor="import-replace" className="cursor-pointer font-medium">Reemplazar todo</label>
            <p id="import-replace-hint" className="text-[13px] text-ink-3">Borra todas las operaciones cargadas antes de importar.</p>
          </div>
        </div>

        {replace && (
          <div role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-[13px]">
            <p className="font-medium text-danger">Acción destructiva e irreversible</p>
            <p className="mt-1 text-ink-2">
              Se borran posiciones, trades cerrados y todas las transacciones.
              Los depósitos, retiros y ajustes de saldo cargados a mano se conservan.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 max-[419px]:grid max-[419px]:grid-cols-1">
          <button type="button" onClick={onClose} className="min-h-11 rounded-md px-4 font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancelar</button>
          <button type="button" onClick={handleImport} disabled={!file || loading} aria-busy={loading}
            className="min-h-11 rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 max-[419px]:row-start-1">
            {loading ? 'Importando…' : 'Importar operaciones'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
