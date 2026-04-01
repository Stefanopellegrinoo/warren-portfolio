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

// Schema for GET /api/cash/movements query params
export const CashMovementQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  type: z.enum(['DEPOSITO', 'RETIRO', 'CUPON', 'DIVIDENDO']).optional(),
})