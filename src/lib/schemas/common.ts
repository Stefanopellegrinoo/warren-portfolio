import { z } from 'zod'
import './locale'

// Common schemas used across multiple endpoints. Messages reach the user verbatim
// (src/lib/api/validation.ts), so each one names its field in plain Spanish.
export const UUIDSchema = z.string({ message: 'Identificador inválido' }).uuid({
  message: 'Identificador inválido',
})

export const DateSchema = z.string({ message: 'Ingresá una fecha' }).regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'La fecha tiene que tener el formato AAAA-MM-DD',
}).refine((val) => {
  const date = new Date(val);
  return date instanceof Date && !isNaN(date.getTime()) && val === date.toISOString().split('T')[0];
}, {
  message: 'La fecha no existe. Revisá el día y el mes.',
})

/** A number above zero; `label` names the field with its article ("La cantidad"). */
export const positiveNumber = (label: string) =>
  z.number({ message: `${label} tiene que ser un número` }).positive({ message: `${label} tiene que ser mayor a 0` })

export const CommissionSchema = z.number({ message: 'La comisión tiene que ser un número' }).min(0, {
  message: 'La comisión no puede ser negativa',
})

export const TickerSchema = z.string({ message: 'Ingresá el ticker' }).min(1, {
  message: 'Ingresá el ticker',
}).transform((val) => val.toUpperCase().trim())

// Pagination schema for list endpoints
export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type PaginationParams = z.infer<typeof PaginationSchema>

// Pagination response helper
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}