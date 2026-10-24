'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { requestErrorMessage } from '@/lib/request-errors'
import { DialogActions, StrategyDialog, field, ghostButton, iconButton, label, primaryButton, textLink } from './ui'
import type {
  IndicatorSetup,
  IndicatorParam,
  ConditionRule,
  IndicatorType,
  IndicatorOperator,
  SetupConfig,
} from '@/types'

// ─── extended types with stable IDs ───────────────────────────────────────────

interface IndicatorParamWithId extends IndicatorParam {
  _id: string
}

interface ConditionRuleWithId extends ConditionRule {
  _id: string
}

// ─── constants ───────────────────────────────────────────────────────────────

const INDICATOR_TYPES: IndicatorType[] = ['EMA', 'RSI', 'MACD', 'Bollinger', 'Volume']

const OPERATORS: { value: IndicatorOperator; label: string }[] = [
  { value: 'crosses_above', label: 'Cruza hacia arriba' },
  { value: 'crosses_below', label: 'Cruza hacia abajo' },
  { value: 'gt', label: 'Mayor que (>)' },
  { value: 'lt', label: 'Menor que (<)' },
  { value: 'gte', label: 'Mayor o igual (≥)' },
  { value: 'lte', label: 'Menor o igual (≤)' },
]

// ─── helpers ─────────────────────────────────────────────────────────────────

function defaultIndicator(type: IndicatorType): IndicatorParam {
  switch (type) {
    case 'EMA': return { type, period: 20 }
    case 'RSI': return { type, period: 14 }
    case 'MACD': return { type, fast: 12, slow: 26, signal: 9 }
    case 'Bollinger': return { type, period: 20 }
    case 'Volume': return { type }
    default: return { type }
  }
}

function defaultCondition(): ConditionRule {
  return { indicator: 'EMA', period: 20, operator: 'crosses_above', value: 0 }
}

// ─── sub-components ──────────────────────────────────────────────────────────

const small = cn(field, 'w-24')
const rowClass = 'grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-b border-line py-3 last:border-b-0'

/** A labelled control inside a row; the id ties the label to its input. */
function Cell({ id, text, children }: { id: string; text: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-[13px] text-ink-2">{text}</label>
      {children}
    </div>
  )
}

function NumberInput({ id, value, onChange, min, wide }: { id: string; value: number | undefined; onChange: (v: string) => void; min?: number; wide?: boolean }) {
  return <input id={id} type="number" inputMode="numeric" className={wide ? cn(field, 'w-28') : small} value={value ?? ''} min={min} onChange={(e) => onChange(e.target.value)} />
}

function TypeSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: IndicatorType) => void }) {
  return (
    <select id={id} className={cn(field, 'w-32')} value={value} onChange={(e) => onChange(e.target.value as IndicatorType)}>
      {INDICATOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  )
}

function RemoveButton({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button type="button" className={`${iconButton} hover:text-danger`} onClick={onClick} aria-label={text} title={text}>
      <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
    </button>
  )
}

function IndicatorRow({
  ind,
  index,
  onChange,
  onRemove,
}: {
  ind: IndicatorParamWithId
  index: number
  onChange: (updated: IndicatorParamWithId) => void
  onRemove: () => void
}) {
  const id = (k: string) => `ind-${ind._id}-${k}`
  return (
    <li className={rowClass}>
      <div className="flex flex-wrap items-end gap-3">
      <Cell id={id('type')} text="Tipo">
        <TypeSelect id={id('type')} value={ind.type} onChange={(v) => onChange({ ...defaultIndicator(v), _id: ind._id })} />
      </Cell>

      {(ind.type === 'EMA' || ind.type === 'RSI' || ind.type === 'Bollinger') && (
        <Cell id={id('period')} text="Período">
          <NumberInput id={id('period')} value={ind.period} min={1} onChange={(v) => onChange({ ...ind, period: parseInt(v) || undefined })} />
        </Cell>
      )}

      {ind.type === 'MACD' && (
        <>
          <Cell id={id('fast')} text="Rápida">
            <NumberInput id={id('fast')} value={ind.fast} min={1} onChange={(v) => onChange({ ...ind, fast: parseInt(v) || undefined })} />
          </Cell>
          <Cell id={id('slow')} text="Lenta">
            <NumberInput id={id('slow')} value={ind.slow} min={1} onChange={(v) => onChange({ ...ind, slow: parseInt(v) || undefined })} />
          </Cell>
          <Cell id={id('signal')} text="Señal">
            <NumberInput id={id('signal')} value={ind.signal} min={1} onChange={(v) => onChange({ ...ind, signal: parseInt(v) || undefined })} />
          </Cell>
        </>
      )}

      </div>
      <RemoveButton text={`Quitar el indicador ${index + 1}`} onClick={onRemove} />
    </li>
  )
}

function ConditionRow({
  rule,
  index,
  side,
  onChange,
  onRemove,
}: {
  rule: ConditionRuleWithId
  index: number
  side: string
  onChange: (updated: ConditionRuleWithId) => void
  onRemove: () => void
}) {
  const useTarget = rule.operator === 'crosses_above' || rule.operator === 'crosses_below'
  const id = (k: string) => `cond-${rule._id}-${k}`

  return (
    <li className={rowClass}>
      <div className="flex flex-wrap items-end gap-3">
      <Cell id={id('indicator')} text="Indicador">
        <TypeSelect id={id('indicator')} value={rule.indicator} onChange={(v) => onChange({ ...rule, indicator: v })} />
      </Cell>

      {rule.indicator !== 'Volume' && (
        <Cell id={id('period')} text="Período">
          <NumberInput id={id('period')} value={rule.period} min={1} onChange={(v) => onChange({ ...rule, period: parseInt(v) || undefined })} />
        </Cell>
      )}

      <Cell id={id('operator')} text="Operador">
        <select
          id={id('operator')}
          className={cn(field, 'w-48')}
          value={rule.operator}
          onChange={(e) => {
            const op = e.target.value as IndicatorOperator
            const isCross = op === 'crosses_above' || op === 'crosses_below'
            onChange({
              ...rule,
              operator: op,
              target: isCross ? (rule.target ?? 'EMA') : undefined,
              targetPeriod: isCross ? (rule.targetPeriod ?? 20) : undefined,
              value: isCross ? undefined : (rule.value ?? 0),
            })
          }}
        >
          {OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
      </Cell>

      {useTarget ? (
        <>
          <Cell id={id('target')} text="Contra">
            <TypeSelect id={id('target')} value={rule.target ?? 'EMA'} onChange={(v) => onChange({ ...rule, target: v })} />
          </Cell>
          {rule.target !== 'Volume' && (
            <Cell id={id('target-period')} text="Período">
              <NumberInput id={id('target-period')} value={rule.targetPeriod} min={1} onChange={(v) => onChange({ ...rule, targetPeriod: parseInt(v) || undefined })} />
            </Cell>
          )}
        </>
      ) : (
        <Cell id={id('value')} text="Valor">
          <NumberInput id={id('value')} wide value={rule.value} onChange={(v) => onChange({ ...rule, value: parseFloat(v) || undefined })} />
        </Cell>
      )}

      </div>
      <RemoveButton text={`Quitar la condición de ${side} ${index + 1}`} onClick={onRemove} />
    </li>
  )
}

/** One block of the form: a heading, its rows and the add action. */
function Group({ id, title, hint, empty, onAdd, addText, children }: {
  id: string
  title: string
  hint?: string
  empty: string | null
  onAdd: () => void
  addText: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
        <h3 id={id} className="text-sm font-semibold">
          {title}
          {hint && <span className="ml-1 font-normal text-ink-3">{hint}</span>}
        </h3>
        <button type="button" className={textLink} onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          {addText}
        </button>
      </div>
      {empty ? <p className="py-2 text-[13px] text-ink-3">{empty}</p> : <ul>{children}</ul>}
    </section>
  )
}

// ─── props ───────────────────────────────────────────────────────────────────

interface SetupFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  strategyId: string
  setup?: IndicatorSetup
  onSuccess: (setup: IndicatorSetup) => void
}

// ─── main component ──────────────────────────────────────────────────────────

export function SetupFormModal({
  open,
  onOpenChange,
  strategyId,
  setup,
  onSuccess,
}: SetupFormModalProps) {
  const isEdit = !!setup

  const [name, setName] = useState('')
  const [indicators, setIndicators] = useState<IndicatorParamWithId[]>([])
  const [buyConditions, setBuyConditions] = useState<ConditionRuleWithId[]>([])
  const [sellConditions, setSellConditions] = useState<ConditionRuleWithId[]>([])
  const [stopLoss, setStopLoss] = useState<string>('')
  const [takeProfit, setTakeProfit] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(setup?.name ?? '')
      setIndicators(
        (setup?.config.indicators ?? []).map((ind) => ({
          ...ind,
          _id: crypto.randomUUID(),
        }))
      )
      setBuyConditions(
        (setup?.config.conditions.buy ?? []).map((c) => ({
          ...c,
          _id: crypto.randomUUID(),
        }))
      )
      setSellConditions(
        (setup?.config.conditions.sell ?? []).map((c) => ({
          ...c,
          _id: crypto.randomUUID(),
        }))
      )
      setStopLoss(setup?.config.stopLoss !== undefined ? String(setup.config.stopLoss) : '')
      setTakeProfit(setup?.config.takeProfit !== undefined ? String(setup.config.takeProfit) : '')
      setError(null)
    }
  }, [open, setup])

  // ── indicator mutations ──

  function addIndicator() {
    setIndicators((prev) => [
      ...prev,
      { ...defaultIndicator('EMA'), _id: crypto.randomUUID() },
    ])
  }

  function updateIndicator(index: number, updated: IndicatorParamWithId) {
    setIndicators((prev) => prev.map((ind, i) => (i === index ? updated : ind)))
  }

  function removeIndicator(index: number) {
    setIndicators((prev) => prev.filter((_, i) => i !== index))
  }

  // ── condition mutations ──

  function addBuyCondition() {
    setBuyConditions((prev) => [
      ...prev,
      { ...defaultCondition(), _id: crypto.randomUUID() },
    ])
  }

  function updateBuyCondition(index: number, updated: ConditionRuleWithId) {
    setBuyConditions((prev) => prev.map((c, i) => (i === index ? updated : c)))
  }

  function removeBuyCondition(index: number) {
    setBuyConditions((prev) => prev.filter((_, i) => i !== index))
  }

  function addSellCondition() {
    setSellConditions((prev) => [
      ...prev,
      { ...defaultCondition(), _id: crypto.randomUUID() },
    ])
  }

  function updateSellCondition(index: number, updated: ConditionRuleWithId) {
    setSellConditions((prev) => prev.map((c, i) => (i === index ? updated : c)))
  }

  function removeSellCondition(index: number) {
    setSellConditions((prev) => prev.filter((_, i) => i !== index))
  }

  // ── submit ──

  const isDisabled = !name.trim() || indicators.length === 0 || loading

  async function handleSubmit() {
    setError(null)
    setLoading(true)

    // Remove _id from indicators and conditions before sending to server
    const cleanIndicators = indicators.map(({ _id, ...rest }) => rest)
    const cleanBuy = buyConditions.map(({ _id, ...rest }) => rest)
    const cleanSell = sellConditions.map(({ _id, ...rest }) => rest)

    const config: SetupConfig = {
      indicators: cleanIndicators,
      conditions: {
        buy: cleanBuy,
        sell: cleanSell,
      },
      ...(stopLoss !== '' ? { stopLoss: parseFloat(stopLoss) } : {}),
      ...(takeProfit !== '' ? { takeProfit: parseFloat(takeProfit) } : {}),
    }

    const body = { name: name.trim(), config }

    try {
      const url = isEdit
        ? `/api/strategies/${strategyId}/setups/${setup!.id}`
        : `/api/strategies/${strategyId}/setups`
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Error al guardar el setup')
      }

      const data = await res.json() as { setup: IndicatorSetup }

      toast.success(isEdit ? 'Setup actualizado' : 'Setup creado')
      onSuccess(data.setup)
      onOpenChange(false)
    } catch (err) {
      const message = requestErrorMessage(err, 'No se pudo guardar el setup.')
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o) }}>
      <StrategyDialog title={isEdit ? 'Editar setup' : 'Nuevo setup'} width={720}>
        <form onSubmit={(e) => { e.preventDefault(); if (!isDisabled) handleSubmit() }}>
          <div className="grid gap-6 px-5 py-5">
            <div className="grid gap-2">
              <label htmlFor="setup-name" className={label}>Nombre</label>
              <input id="setup-name" required className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Cruce de EMA con filtro RSI" />
            </div>

            <Group
              id="setup-indicators"
              title="Indicadores"
              hint="(al menos uno)"
              empty={indicators.length === 0 ? 'Sin indicadores. Agregá al menos uno.' : null}
              onAdd={addIndicator}
              addText="Agregar indicador"
            >
              {indicators.map((ind, i) => (
                <IndicatorRow key={ind._id} ind={ind} index={i} onChange={(updated) => updateIndicator(i, updated)} onRemove={() => removeIndicator(i)} />
              ))}
            </Group>

            <Group
              id="setup-buy"
              title="Condiciones de compra"
              empty={buyConditions.length === 0 ? 'Sin condiciones de compra.' : null}
              onAdd={addBuyCondition}
              addText="Agregar condición"
            >
              {buyConditions.map((rule, i) => (
                <ConditionRow key={rule._id} rule={rule} index={i} side="compra" onChange={(updated) => updateBuyCondition(i, updated)} onRemove={() => removeBuyCondition(i)} />
              ))}
            </Group>

            <Group
              id="setup-sell"
              title="Condiciones de venta"
              empty={sellConditions.length === 0 ? 'Sin condiciones de venta.' : null}
              onAdd={addSellCondition}
              addText="Agregar condición"
            >
              {sellConditions.map((rule, i) => (
                <ConditionRow key={rule._id} rule={rule} index={i} side="venta" onChange={(updated) => updateSellCondition(i, updated)} onRemove={() => removeSellCondition(i)} />
              ))}
            </Group>

            <div className="grid grid-cols-2 gap-4 max-[479px]:grid-cols-1">
              <div className="grid gap-2">
                <label htmlFor="setup-sl" className={label}>Stop loss <span className="font-normal text-ink-3">(%)</span></label>
                <input id="setup-sl" type="number" inputMode="decimal" className={field} value={stopLoss} min={0} step={0.1} placeholder="Ej.: 3" onChange={(e) => setStopLoss(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <label htmlFor="setup-tp" className={label}>Take profit <span className="font-normal text-ink-3">(%)</span></label>
                <input id="setup-tp" type="number" inputMode="decimal" className={field} value={takeProfit} min={0} step={0.1} placeholder="Ej.: 9" onChange={(e) => setTakeProfit(e.target.value)} />
              </div>
            </div>

            {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          </div>

          <DialogActions>
            <button type="button" className={ghostButton} onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className={primaryButton} disabled={isDisabled} aria-busy={loading}>
              {loading ? 'Guardando…' : 'Guardar'}
            </button>
          </DialogActions>
        </form>
      </StrategyDialog>
    </Dialog>
  )
}
