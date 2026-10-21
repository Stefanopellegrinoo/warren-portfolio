// Freshness of the ON terms catalog, for /api/health. Informational only: it must
// never change the probe's status code (that stays driven by Redis + Supabase).
import type { SupabaseClient } from '@supabase/supabase-js'
import { addBusinessDays } from './ar-calendar'

/** Stale = more than this many business days behind (A13: tunable constant). */
export const ON_TERMS_STALE_BUSINESS_DAYS = 2

export interface OnTermsFreshness {
  asOf: string | null
  stale: boolean
}

export function isOnTermsStale(asOf: string, today: string): boolean {
  return addBusinessDays(asOf, ON_TERMS_STALE_BUSINESS_DAYS) < today
}

/** Latest on_terms.as_of. Null when unreadable. Never throws. */
export async function readOnTermsFreshness(supabase: SupabaseClient, today: string): Promise<OnTermsFreshness | null> {
  try {
    const { data, error } = await supabase.from('on_terms').select('as_of').order('as_of', { ascending: false }).limit(1)
    if (error) return null
    const asOf: string | null = data?.[0]?.as_of ?? null
    return { asOf, stale: asOf === null || isOnTermsStale(asOf, today) }
  } catch {
    return null
  }
}
