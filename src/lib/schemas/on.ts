import { z } from 'zod'
import { CommissionSchema, DateSchema, positiveNumber, TickerSchema } from './common'

export const ONTransactionSchema = z.object({
  date: DateSchema,
  ticker: TickerSchema,
  // No CUPON: coupons and amortizations come from the bond schedule (odd/tasks/nucleo-ledger.md S4, S10).
  operation: z.enum(['COMPRA', 'VENTA'], { message: 'Elegí una operación: compra o venta' }),
  quantity: positiveNumber('La cantidad').max(100_000, {
    message: 'La cantidad no puede superar 100.000',
  }),
  price: positiveNumber('El precio').max(10_000, {
    message: 'El precio no puede superar 10.000',
  }),
  commission: CommissionSchema.default(0),
  notes: z.string().optional(),
})