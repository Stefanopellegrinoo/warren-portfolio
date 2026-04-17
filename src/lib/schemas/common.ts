import { z } from 'zod'

// Common schemas used across multiple endpoints
export const UUIDSchema = z.string().uuid({
  message: 'Must be a valid UUID',
})

export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Date must be in YYYY-MM-DD format',
}).refine((val) => {
  const date = new Date(val);
  return date instanceof Date && !isNaN(date.getTime()) && val === date.toISOString().split('T')[0];
}, {
  message: 'Must be a valid calendar date',
})

export const PositiveNumberSchema = z.number().positive({
  message: 'Must be a positive number',
})

export const TickerSchema = z.string().min(1, {
  message: 'Ticker is required',
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