import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { serverError } from '@/lib/api/errors'
import { INVALID_JSON } from '@/lib/api/validation'
import { MAX_BODY_BYTES, fromIndicatorColumn, isEmptyPatch, parsePatch, parsePreferences, toIndicatorColumn } from '@/lib/chart/preferences-schema'

// The user's chart preferences: favorite tools, remembered drawing styles, saved indicator settings
// (odd/tasks/chart-customization.md S4) and which indicators are on, hidden or minimized
// (odd/tasks/chart-pro-redesign.md S2, kept in indicator_settings under "<key>:visibility"). One row per
// user (migration 051); a PATCH merges per key in the database, so a device that changed one tool's style
// never wipes another tool changed elsewhere.
const ROUTE_LIMIT = 30
const ROUTE_WINDOW_SEC = 60
const TAG = 'API /chart-preferences'

const INVALID_PREFERENCES = 'No se pudieron guardar los ajustes del gráfico. Recargá la página y probá de nuevo.'
const PREFERENCES_TOO_LARGE = 'Los ajustes del gráfico son demasiado grandes para guardarlos.'

async function signedInWithinLimit() {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth
  if (!(await rateLimit(`rl:chart-preferences:${auth.user.id}`, ROUTE_LIMIT, ROUTE_WINDOW_SEC))) {
    return { error: tooManyRequests(ROUTE_WINDOW_SEC) }
  }
  return auth
}

export async function GET() {
  const auth = await signedInWithinLimit()
  if (isAuthFailure(auth)) return auth.error
  const { supabase, user } = auth

  const { data, error } = await supabase
    .from('chart_preferences')
    .select('favorites, tool_styles, indicator_settings')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return serverError(TAG, error)

  // userId lets the device tell its saved changes apart from another account's on the same browser.
  return NextResponse.json({
    userId: user.id,
    preferences: parsePreferences({ favorites: data?.favorites, toolStyles: data?.tool_styles, ...fromIndicatorColumn(data?.indicator_settings) }),
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await signedInWithinLimit()
  if (isAuthFailure(auth)) return auth.error
  const { supabase } = auth

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: PREFERENCES_TOO_LARGE }, { status: 400 })
  }
  const text = await req.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: PREFERENCES_TOO_LARGE }, { status: 400 })
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: INVALID_JSON }, { status: 400 })
  }
  const patch = parsePatch(body)
  if (!patch || isEmptyPatch(patch)) return NextResponse.json({ error: INVALID_PREFERENCES }, { status: 400 })

  // patch_chart_preferences runs as the user (RLS) and writes the row of auth.uid().
  const { error } = await supabase.rpc('patch_chart_preferences', {
    p_favorites: patch.favorites ?? {},
    p_tool_styles: patch.toolStyles ?? {},
    p_indicator_settings: toIndicatorColumn(patch),
  })
  if (error) return serverError(TAG, error)
  return new NextResponse(null, { status: 204 })
}
