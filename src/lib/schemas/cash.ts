import { z } from 'zod'
import { DateSchema, PositiveNumberSchema } from './common'

export const CashMovementSchema = z.object({
  date: DateSchema,
  type: z.enum(['DEPOSITO', 'RETIRO', 'CUPON', 'DIVIDENDO'], {
    message: 'Type must be DEPOSITO, RETIRO, CUPON, or DIVIDENDO',
  }),
  amount: PositiveNumberSchema.max(1_000_000, {
    message: 'Amount cannot exceed $1,000,000',
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
    .number({ message: 'Balance must be a number' })
    .finite({ message: 'Balance must be a finite number' })
    .min(-100_000_000, { message: 'Balance is out of range' })
    .max(100_000_000, { message: 'Balance is out of range' }),
  date: DateSchema,
  description: z.string().max(200).optional(),
})

// Schema for GET /api/cash/movements query params
export const CashMovementQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  type: z.enum(['DEPOSITO', 'RETIRO', 'CUPON', 'DIVIDENDO']).optional(),
})