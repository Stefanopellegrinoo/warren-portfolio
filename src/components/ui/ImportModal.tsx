'use client'

import { useState, useRef, useEffect } from 'react'
import { formatNumber } from '@/lib/utils'
import { X, Upload, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import {
  DiscardPrompt, dangerCls, primaryCls, secondaryCls, sheetBodyCls, sheetCls, sheetFootCls, sheetHeadCls, useDiscardGuard,
} from './AddTransactionModal'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

type ImportError = { line: number; ticker?: string; error: string }
const SHOWN_ERRORS = 10
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The file's errors as a list a person can read: the first ten, then how many more. */
function ImportErrors({ errors }: { errors: ImportError[] }) {
  const lineErrors = errors.filter(e => e.line > 0).length
  const rest = errors.length - SHOWN_ERRORS
  return (
    <div className="grid gap-1">
      {lineErrors > 0 && <p>El archivo tiene {plural(lineErrors, 'error', 'errores')}. Corregilos y volvé a importarlo.</p>}
      <ul className="grid max-h-[40dvh] list-disc gap-0.5 overflow-y-auto pl-4">
        {errors.slice(0, SHOWN_ERRORS).map((e, i) => (
          <li key={i}>
            {e.line > 0 ? `Línea ${e.line}: ` : ''}{e.error}
            {e.ticker && e.ticker !== 'UNKNOWN' && e.ticker !== 'BATCH' ? ` (${e.ticker})` : ''}
          </li>
        ))}
        {rest > 0 && <li>y {rest} más</li>}
      </ul>
    </div>
  )
}

function showFailure(toastId: string, result: { errors?: ImportError[]; message?: string } | undefined) {
  const errors = result?.errors?.length ? result.errors : [{ line: 0, error: result?.message || 'La importación falló. Probá de nuevo.' }]
  // Stays until closed: a list of errors takes longer to read than a toast lasts.
  toast.error('No se importó ninguna operación', {
    id: toastId, description: <ImportErrors errors={errors} />, duration: Infinity, closeButton: true,
    classNames: { icon: 'self-start mt-0.5' },
  })
}

export default function ImportModal({ onClose, onSuccess }: Props) {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [replace, setReplace] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const guard = useDiscardGuard(!!file || replace, onClose, content)

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
    setConfirmReplace(false)
    setError(null)
    setLoading(true)

    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/transactions/import?replace=${replace}`, {
        method: 'POST', body: fd,
      })
      const data = await res.json().catch(() => null)

      // The file never started importing: say why next to it (the API answers in Spanish, naming the line).
      if (!res.ok || !data?.jobId) {
        setError(data?.error || 'No se pudo importar el archivo. Probá de nuevo.')
        setLoading(false)
        return
      }

      const jobId = data.jobId
      onClose()

      const toastId = `import-progress-${jobId}`
      toast.loading('Importando operaciones…', {
        id: toastId,
        description: '0% · Empezando',
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
            toast.loading(sData.progress.message || 'Procesando…', {
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
              toast.success('Importación terminada', {
                id: toastId,
                description: `${plural(finalResult.imported, 'operación importada', 'operaciones importadas')}`,
                duration: 5000,
              })
              setTimeout(() => {
                onSuccess()
              }, 2500)
            } else if (!finalResult.success) {
              // The import is all or nothing: one bad line and nothing was saved.
              showFailure(toastId, finalResult)
            } else {
              toast.info('Importación terminada', {
                id: toastId,
                description: 'No había operaciones nuevas para importar',
                duration: 3000,
              })
            }
            setLoading(false)
          } else if (sData.state === 'failed') {
            clearInterval(interval)
            showFailure(toastId, sData.result)
            setLoading(false)
          }
        } catch {
          clearInterval(interval)
          toast.error('No sabemos si la importación terminó', {
            id: toastId,
            description: 'Se perdió la conexión mientras se importaba. Revisá tus operaciones en un rato.',
          })
          setLoading(false)
        }
      }, 1000)

    } catch {
      setError('No se pudo conectar. Revisá tu conexión y probá de nuevo.')
      setLoading(false)
    }
  }

  return (
    <dialog ref={dialog} {...guard.dialogProps} aria-labelledby="import-title" className={sheetCls}>
      <div ref={content} className="flex min-h-0 flex-1 flex-col">
        <div className={sheetHeadCls}>
          <div className="min-w-0 flex-1">
            <h2 id="import-title" className="font-serif text-2xl">Importar operaciones</h2>
            <p className="mt-1 text-[13px] text-ink-3">
              Un archivo Excel con las columnas FECHA, TICKER, OPERACIÓN, CANTIDAD, PRECIO y COMISIÓN.
            </p>
          </div>
          <button type="button" onClick={guard.requestClose} aria-label="Cerrar" className="-mr-2 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-11 max-[819px]:w-11">
            <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className={sheetBodyCls}>
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
                <span className="font-medium [overflow-wrap:anywhere]">{file.name}</span>
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

          {/* The whole row is the tap target. */}
          <label htmlFor="import-replace" className="grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3">
            <input id="import-replace" type="checkbox" checked={replace} aria-describedby="import-replace-hint"
              onChange={e => { setReplace(e.target.checked); setConfirmReplace(false) }}
              className="mt-0.5 h-5 w-5 cursor-pointer accent-[var(--accent)]" />
            <span>
              <span className="block font-medium">Reemplazar todo</span>
              <span id="import-replace-hint" className="block text-[13px] text-ink-3">Borra todas las operaciones cargadas antes de importar.</span>
            </span>
          </label>

          {replace && (
            <div className="rounded-md bg-danger-soft px-3 py-2.5 text-[13px]">
              <p className="font-medium text-danger">Acción destructiva e irreversible</p>
              <p className="mt-1 text-ink-2">
                Se borran posiciones, trades cerrados y todas las transacciones.
                Los depósitos, retiros y ajustes de saldo cargados a mano se conservan.
              </p>
            </div>
          )}
        </div>

        <div className={sheetFootCls}>
          {confirmReplace ? (
            <div role="alert" className="grid gap-3">
              <p className="font-medium">Se van a borrar todas tus operaciones y reemplazar por las del archivo. No se puede deshacer.</p>
              <div className="flex justify-end gap-2 max-[419px]:grid max-[419px]:grid-cols-1">
                {/* The safe choice takes the focus. */}
                <button type="button" autoFocus onClick={() => setConfirmReplace(false)} className={`${secondaryCls} border border-line-strong`}>Volver</button>
                <button type="button" onClick={handleImport} className={`${dangerCls} max-[419px]:row-start-1`}>Borrar y reemplazar</button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2 max-[419px]:grid max-[419px]:grid-cols-1">
              <button type="button" onClick={onClose} className={secondaryCls}>Cancelar</button>
              <button type="button" onClick={() => (replace ? setConfirmReplace(true) : handleImport())} disabled={!file || loading} aria-busy={loading}
                className={`${primaryCls} disabled:cursor-not-allowed disabled:opacity-50 max-[419px]:row-start-1`}>
                {loading ? 'Importando…' : 'Importar operaciones'}
              </button>
            </div>
          )}
        </div>
      </div>
      {guard.asking && <DiscardPrompt onDiscard={onClose} onKeep={guard.keepEditing} />}
    </dialog>
  )
}
