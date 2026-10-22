import { z } from 'zod'
import { DateSchema, PositiveNumberSchema, TickerSchema } from './common'

// Schema for single transaction (POST /api/transactions)
export const TransactionSchema = z.object({
  date: DateSchema,
  ticker: TickerSchema,
  operation: z.enum(['COMPRA', 'VENTA', 'DIVIDENDO'], {
    message: 'Operation must be COMPRA, VENTA, or DIVIDENDO',
  }),
  quantity: PositiveNumberSchema.max(1_000_000, {
    message: 'Quantity cannot exceed 1,000,000',
  }),
  price: PositiveNumberSchema.max(1_000_000, {
    message: 'Price cannot exceed $1,000,000',
  }),
  commission: z.number().min(0).optional().default(0),
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
        message: `ON tickers must end with 'D' for Dollar-MEP bonds. '${ticker}' is invalid.`,
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
  operation: z.enum(['COMPRA', 'VENTA', 'DIVIDENDO'], {
    message: 'Operation must be COMPRA, VENTA, or DIVIDENDO',
  }),
  assetType: z.literal('CEDEAR'),
  tradeCurrency: z.enum(['ARS', 'MEP', 'CCL']),
  tradeQuantity: PositiveNumberSchema.max(10_000_000, { message: 'Quantity cannot exceed 10,000,000' }),
  tradePrice: PositiveNumberSchema.max(1_000_000_000, { message: 'Price cannot exceed 1,000,000,000' }),
  tradeCommission: z.number().min(0).optional().default(0),
  fxMep: PositiveNumberSchema.optional(),
  fxCcl: PositiveNumberSchema.optional(),
  notes: z.string().optional(),
  confirmTicker: z.boolean().optional(),
})

export type CedearTradeInput = z.infer<typeof CedearTradeSchema>

// Schema for bulk import (POST /api/transactions/import with JSON body)
export const TransactionImportSchema = z.object({
  transactions: z.array(TransactionSchema).min(1, {
    message: 'At least one transaction is required',
  }).max(10_000, {
    message: 'Cannot import more than 10,000 transactions at once',
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
  jobId: z.string().min(1, { message: 'jobId is required' }),
})
