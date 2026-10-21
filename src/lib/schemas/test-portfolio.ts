import { z } from 'zod'

export const MAX_PORTFOLIOS = 20 // per user (A6), also enforced by migration 040
export const MAX_ITEMS = 50 // per portfolio
export const MAX_NAME = 60
export const MAX_AMOUNT = 1e12

export const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/
export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const PortfolioNameSchema = z.strictObject({
  name: z.string({ message: 'Ingresá un nombre' }).trim().min(1, 'Ingresá un nombre').max(MAX_NAME, `Máximo ${MAX_NAME} caracteres`),
})

const amount = z.number({ message: 'El monto debe ser un número' }).finite().positive('El monto debe ser mayor a cero').max(MAX_AMOUNT, 'Monto demasiado grande')
const mode = z.enum(['usd', 'vn'], { message: 'Modo inválido' })
const manualPrice = z.number({ message: 'El precio debe ser un número' }).finite().positive('El precio debe ser mayor a cero').max(1e6, 'Precio demasiado grande')

export const ItemCreateSchema = z.strictObject({
  isin: z.string().trim().toUpperCase().regex(ISIN_RE, 'ISIN inválido'),
  mode,
  amount,
  manualPrice: manualPrice.nullish().transform((v) => v ?? null),
})

export const ItemUpdateSchema = z
  .strictObject({ mode: mode.optional(), amount: amount.optional(), manualPrice: manualPrice.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para actualizar' })

export type ItemCreate = z.infer<typeof ItemCreateSchema>
export type ItemUpdate = z.infer<typeof ItemUpdateSchema>
