'use client'

import { useState, useEffect } from 'react'
import { X, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  { value: 'crosses_above', label: 'cruza arriba' },
  { value: 'crosses_below', label: 'cruza abajo' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
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

function IndicatorRow({
  ind,
  onChange,
  onRemove,
}: {
  ind: IndicatorParamWithId
  onChange: (updated: IndicatorParamWithId) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-slate-500 font-mono">Tipo</label>
        <Select
          value={ind.type}
          onValueChange={(v) => onChange({
            ...defaultIndicator(v as IndicatorType),
            _id: ind._id,
          })}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDICATOR_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* EMA / RSI / Bollinger — period */}
      {(ind.type === 'EMA' || ind.type === 'RSI' || ind.type === 'Bollinger') && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 font-mono">Período</label>
          <Input
            type="number"
            className="w-20 h-7 text-xs"
            value={ind.period ?? ''}
            min={1}
            onChange={(e) => onChange({ ...ind, period: parseInt(e.target.value) || undefined })}
          />
        </div>
      )}

      {/* MACD */}
      {ind.type === 'MACD' && (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-mono">Fast</label>
            <Input
              type="number"
              className="w-16 h-7 text-xs"
              value={ind.fast ?? ''}
              min={1}
              onChange={(e) => onChange({ ...ind, fast: parseInt(e.target.value) || undefined })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-mono">Slow</label>
            <Input
              type="number"
              className="w-16 h-7 text-xs"
              value={ind.slow ?? ''}
              min={1}
              onChange={(e) => onChange({ ...ind, slow: parseInt(e.target.value) || undefined })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-mono">Signal</label>
            <Input
              type="number"
              className="w-16 h-7 text-xs"
              value={ind.signal ?? ''}
              min={1}
              onChange={(e) => onChange({ ...ind, signal: parseInt(e.target.value) || undefined })}
            />
          </div>
        </>
      )}

      <button
        type="button"
        className="btn-ghost p-1.5 text-red-400 hover:text-red-300 ml-auto"
        onClick={onRemove}
        title="Eliminar indicador"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function ConditionRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: ConditionRuleWithId
  onChange: (updated: ConditionRuleWithId) => void
  onRemove: () => void
}) {
  const useTarget = rule.operator === 'crosses_above' || rule.operator === 'crosses_below'

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
      {/* Indicator source */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-slate-500 font-mono">Indicador</label>
        <Select
          value={rule.indicator}
          onValueChange={(v) => onChange({ ...rule, indicator: v as IndicatorType })}
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDICATOR_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Period for source indicator */}
      {rule.indicator !== 'Volume' && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 font-mono">Período</label>
          <Input
            type="number"
            className="w-16 h-7 text-xs"
            value={rule.period ?? ''}
            min={1}
            onChange={(e) => onChange({ ...rule, period: parseInt(e.target.value) || undefined })}
          />
        </div>
      )}

      {/* Operator */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-slate-500 font-mono">Operador</label>
        <Select
          value={rule.operator}
          onValueChange={(v) => {
            const op = v as IndicatorOperator
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
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATORS.map((op) => (
              <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Target indicator (crosses) */}
      {useTarget ? (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-mono">Target</label>
            <Select
              value={rule.target ?? 'EMA'}
              onValueChange={(v) => onChange({ ...rule, target: v as IndicatorType })}
            >
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDICATOR_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rule.target !== 'Volume' && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 font-mono">Período target</label>
              <Input
                type="number"
                className="w-20 h-7 text-xs"
                value={rule.targetPeriod ?? ''}
                min={1}
                onChange={(e) =>
                  onChange({ ...rule, targetPeriod: parseInt(e.target.value) || undefined })
                }
              />
            </div>
          )}
        </>
      ) : (
        /* Numeric value (gt / lt / gte / lte) */
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 font-mono">Valor</label>
          <Input
            type="number"
            className="w-20 h-7 text-xs"
            value={rule.value ?? ''}
            onChange={(e) =>
              onChange({ ...rule, value: parseFloat(e.target.value) || undefined })
            }
          />
        </div>
      )}

      <button
        type="button"
        className="btn-ghost p-1.5 text-red-400 hover:text-red-300 ml-auto"
        onClick={onRemove}
        title="Eliminar condición"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
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
      const message = err instanceof Error ? err.message : 'Error inesperado'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar setup' : 'Nuevo setup'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-1">

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-mono">Nombre *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: EMA Cross + RSI Filter"
            />
          </div>

          {/* Indicators */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400 font-mono">
                Indicadores *
              </label>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1 text-xs py-0.5 px-2"
                onClick={addIndicator}
              >
                <Plus className="w-3 h-3" />
                Agregar indicador
              </button>
            </div>

            {indicators.length === 0 && (
              <p className="text-xs text-slate-600 font-mono py-2">
                Sin indicadores. Agregá al menos uno.
              </p>
            )}

            {indicators.map((ind, i) => (
              <IndicatorRow
                key={ind._id}
                ind={ind}
                onChange={(updated) => updateIndicator(i, updated)}
                onRemove={() => removeIndicator(i)}
              />
            ))}
          </div>

          {/* Buy Conditions */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400 font-mono">
                Condiciones BUY
              </label>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1 text-xs py-0.5 px-2"
                onClick={addBuyCondition}
              >
                <Plus className="w-3 h-3" />
                Agregar condición BUY
              </button>
            </div>

            {buyConditions.length === 0 && (
              <p className="text-xs text-slate-600 font-mono py-1">Sin condiciones de compra.</p>
            )}

            {buyConditions.map((rule, i) => (
              <ConditionRow
                key={rule._id}
                rule={rule}
                onChange={(updated) => updateBuyCondition(i, updated)}
                onRemove={() => removeBuyCondition(i)}
              />
            ))}
          </div>

          {/* Sell Conditions */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400 font-mono">
                Condiciones SELL
              </label>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1 text-xs py-0.5 px-2"
                onClick={addSellCondition}
              >
                <Plus className="w-3 h-3" />
                Agregar condición SELL
              </button>
            </div>

            {sellConditions.length === 0 && (
              <p className="text-xs text-slate-600 font-mono py-1">Sin condiciones de venta.</p>
            )}

            {sellConditions.map((rule, i) => (
              <ConditionRow
                key={rule._id}
                rule={rule}
                onChange={(updated) => updateSellCondition(i, updated)}
                onRemove={() => removeSellCondition(i)}
              />
            ))}
          </div>

          {/* Risk params */}
          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs text-slate-400 font-mono">Stop Loss %</label>
              <Input
                type="number"
                value={stopLoss}
                min={0}
                step={0.1}
                placeholder="Ej: 3"
                onChange={(e) => setStopLoss(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs text-slate-400 font-mono">Take Profit %</label>
              <Input
                type="number"
                value={takeProfit}
                min={0}
                step={0.1}
                placeholder="Ej: 9"
                onChange={(e) => setTakeProfit(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 font-mono">{error}</p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary text-xs inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSubmit}
            disabled={isDisabled}
          >
            {loading && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            )}
            Guardar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
