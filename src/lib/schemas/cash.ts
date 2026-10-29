import { z } from 'zod'
import { DateSchema, UUIDSchema, positiveNumber } from './common'

export const CashMovementSchema = z.object({
  date: DateSchema,
  // No CUPON: ON coupons are automatic, and corrected in ONs → Mi cartera (odd/tasks/nucleo-ledger.md S10).
  type: z.enum(['DEPOSITO', 'RETIRO', 'DIVIDENDO'], {
    message: 'Elegí un tipo de movimiento: depósito, retiro o dividendo',
  }),
  amount: positiveNumber('El monto').max(1_000_000, {
    message: 'El monto no puede superar 1.000.000',
  }),
  description: z.string().optional(),
  ticker: z.string().optional(),
})

// Schema for POST /api/cash/adjust
//
// `balance` is the REAL balance the user reports, so unlike CashMovementSchema
// it may be negative and is not capped at 1M — the resulting movement can be
// larger than any single deposit. The bound is a typo guard, not a business rule.
export const CashAdjustSchema = z.object({
  balance: z
    .number({ message: 'El saldo tiene que ser un número' })
    .finite({ message: 'El saldo tiene que ser un número' })
    .min(-100_000_000, { message: 'El saldo no puede ser menor a -100.000.000' })
    .max(100_000_000, { message: 'El saldo no puede superar 100.000.000' }),
  date: DateSchema,
  description: z.string().max(200, { message: 'La descripción puede tener hasta 200 caracteres' }).optional(),
})

// Schema for GET /api/cash/movements query params
export const CashMovementQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  type: z.enum(['DEPOSITO', 'RETIRO', 'CUPON', 'DIVIDENDO']).optional(),
})

// Schema for POST /api/cash/deposit-dates (odd/tasks/deposit-dates.md S3): the proposal as the
// user confirmed it. Only its dates may differ from a fresh proposal, which the route checks.
export const DepositDatesSchema = z.object({
  deposits: z.array(z.object({
    id: UUIDSchema,
    parts: z.array(z.object({ date: DateSchema, amount: positiveNumber('El monto') }))
      .min(1, { message: 'Cada depósito necesita al menos una fecha' })
      .max(1000, { message: 'Demasiadas fechas para un depósito' }),
  }))
    .min(1, { message: 'No hay depósitos para guardar' })
    .max(100, { message: 'Demasiados depósitos de una vez' }),
})

