import { z } from 'zod'
import { CommissionSchema, DateSchema, positiveNumber, TickerSchema } from './common'

const OPERATION_MESSAGE = 'Elegí una operación: compra, venta o dividendo'

/** Also thrown by on-engine.ts, whose message src/lib/api/errors.ts lets through. */
export const onTickerMessage = (ticker: string) =>
  `El ticker de una ON tiene que terminar en D, la especie en dólar MEP. Revisá ${ticker}.`

// Schema for single transaction (POST /api/transactions)
export const TransactionSchema = z.object({
  date: DateSchema,
  ticker: TickerSchema,
  operation: z.enum(['COMPRA', 'VENTA', 'DIVIDENDO'], { message: OPERATION_MESSAGE }),
  quantity: positiveNumber('La cantidad').max(1_000_000, {
    message: 'La cantidad no puede superar 1.000.000',
  }),
  price: positiveNumber('El precio').max(1_000_000, {
    message: 'El precio no puede superar 1.000.000',
  }),
  commission: CommissionSchema.optional().default(0),
  notes: z.string().optional(),
  assetType: z.enum(['ACCION', 'CEDEAR', 'ON']).optional(),
  moneda: z.enum(['ARS', 'USD']).optional(),
  // Request-level acknowledgement that the user saw which instrument this
  // ticker resolves to. Never persisted on the transaction row.
  confirmTicker: z.boolean().optional(),
})
.superRefine((data, ctx) => {
  // Extra validation for ONs: ticker must end with 'D' (Dollar-MEP bonds)
  if (data.assetType === 'ON') {
    const ticker = data.ticker.toUpperCase().trim()
    if (!ticker.endsWith('D')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: onTickerMessage(ticker),
        path: ['ticker'],
      })
    }
  }
})

// Schema for a CEDEAR trade as the broker ticket shows it (POST /api/transactions
// with `tradeCurrency`). The server derives the engine quantity and price from
// these raw values and the trade-date FX (src/lib/trade-record.ts).
// fxMep / fxCcl are sent only when the user edited the pre-filled reference rate.
export const CedearTradeSchema = z.object({
  date: DateSchema,
  ticker: TickerSchema,
  operation: z.enum(['COMPRA', 'VENTA', 'DIVIDENDO'], { message: OPERATION_MESSAGE }),
  assetType: z.literal('CEDEAR'),
  tradeCurrency: z.enum(['ARS', 'MEP', 'CCL'], { message: 'Elegí la moneda: pesos, dólar MEP o dólar cable' }),
  tradeQuantity: positiveNumber('La cantidad').max(10_000_000, { message: 'La cantidad no puede superar 10.000.000' }),
  tradePrice: positiveNumber('El precio').max(1_000_000_000, { message: 'El precio no puede superar 1.000.000.000' }),
  tradeCommission: CommissionSchema.optional().default(0),
  fxMep: positiveNumber('El dólar MEP').optional(),
  fxCcl: positiveNumber('El dólar cable').optional(),
  notes: z.string().optional(),
  confirmTicker: z.boolean().optional(),
})

export type CedearTradeInput = z.infer<typeof CedearTradeSchema>

// Schema for bulk import (POST /api/transactions/import with JSON body)
export const TransactionImportSchema = z.object({
  transactions: z.array(TransactionSchema).min(1, {
    message: 'El archivo no tiene operaciones para importar',
  }).max(10_000, {
    message: 'Se pueden importar hasta 10.000 operaciones por vez',
  }),
})

// Schema for GET query params
export const TransactionQuerySchema = z.object({
  ticker: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

// Schema for import status query params
export const ImportStatusQuerySchema = z.object({
  jobId: z.string({ message: 'Falta el identificador de la importación' }).min(1, { message: 'Falta el identificador de la importación' }),
})
