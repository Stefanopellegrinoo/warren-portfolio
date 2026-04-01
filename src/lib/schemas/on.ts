import { z } from 'zod'
import { DateSchema, PositiveNumberSchema, TickerSchema } from './common'

export const ONTransactionSchema = z.object({
  date: DateSchema,
  ticker: TickerSchema,
  operation: z.enum(['COMPRA', 'VENTA', 'CUPON']),
  quantity: PositiveNumberSchema.max(100_000, {
    message: 'Quantity cannot exceed 100,000',
  }),
  price: PositiveNumberSchema.max(10_000, {
    message: 'Price cannot exceed $10,000',
  }),
  commission: z.number().min(0).default(0),
  notes: z.string().optional(),
})