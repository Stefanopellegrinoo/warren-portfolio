'use client'

import { useEffect, useRef, useState } from 'react'
import { parseEsArNumber } from '@/lib/on-format'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: number | null | undefined
  onValue: (value: number | null) => void
  allowNegative?: boolean
}

function parse(text: string, allowNegative: boolean): number | null {
  const t = text.trim()
  const negative = allowNegative && t.startsWith('-')
  const n = parseEsArNumber(negative ? t.slice(1) : t)
  return n === null ? null : negative ? -n : n
}

const show = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
// The forms keep an empty field as 0, so empty and 0 are the same field state.
const same = (a: number | null | undefined, b: number | null | undefined) => (a || 0) === (b || 0)

/**
 * A money/quantity field typed the Argentine way ("28.080,50"). A
 * type="number" input reads the thousands dot as a decimal point, so
 * "28.080" became 28,08. Keeps the user's text while typing, reports the
 * parsed number, and re-syncs only when the value changes from outside.
 */
export function EsNumberInput({ value, onValue, allowNegative = false, min, ...rest }: Props) {
  const [text, setText] = useState(() => show(value))
  const [synced, setSynced] = useState(value)
  if (!Object.is(value, synced)) {
    setSynced(value)
    if (!same(parse(text, allowNegative), value)) setText(show(value))
  }

  const parsed = parse(text, allowNegative)
  const invalid = text.trim() === ''
    ? ''
    : parsed === null
      ? 'Ingresá un número, por ejemplo 28.080,50'
      : min != null && parsed < Number(min)
        ? `Ingresá un número mayor o igual a ${show(Number(min))}`
        : ''
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.setCustomValidity(invalid) }, [invalid])

  return (
    <input
      {...rest}
      ref={ref}
      min={min}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={e => {
        setText(e.target.value)
        onValue(parse(e.target.value, allowNegative))
      }}
    />
  )
}
