import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireUser, isAuthFailure } from "@/lib/api-auth"
import { serverError } from "@/lib/api/errors"
import { INVALID_JSON } from '@/lib/api/validation'

// One document per user and ticker: the drawing list exactly as the chart's
// DrawingManager exports it. The drawing core validates and migrates it on
// import, so the server only checks the envelope.
const MAX_DRAWINGS = 500

const tickerSchema = z.string().min(1).max(20)

const drawingSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    points: z.array(z.object({ time: z.union([z.number(), z.string()]), price: z.number().finite() }).passthrough()),
  })
  .passthrough()

const bodySchema = z.object({
  ticker: tickerSchema,
  drawings: z.array(drawingSchema).max(MAX_DRAWINGS),
})

export async function GET(req: NextRequest) {
  const parsed = tickerSchema.safeParse(req.nextUrl.searchParams.get("ticker"))
  if (!parsed.success) return NextResponse.json({ error: "Ingresá un ticker válido" }, { status: 400 })

  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  const { supabase, user } = auth

  const { data, error } = await supabase
    .from("chart_drawing_sets")
    .select("drawings")
    .eq("user_id", user.id)
    .eq("ticker", parsed.data.toUpperCase())
    .maybeSingle()

  if (error) return serverError("API /chart-drawings", error)
  if (data) return NextResponse.json({ drawings: data.drawings })

  // Never saved: the legacy chart_drawings rows come in this same response for the client to
  // convert and save, instead of a second request from the phone (odd/tasks/rendimiento.md S2).
  const legacy = await supabase
    .from("chart_drawings")
    .select("id, type, points, style, label")
    .eq("user_id", user.id)
    .eq("ticker", parsed.data.toUpperCase())
    .order("created_at", { ascending: true })
  if (legacy.error) return serverError("API /chart-drawings", legacy.error)
  return NextResponse.json({
    drawings: null,
    legacy: (legacy.data ?? []).map((r) => ({ id: r.id, type: r.type, points: r.points, style: r.style ?? {}, ...(r.label ? { label: r.label } : {}) })),
  })
}

export async function PUT(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: INVALID_JSON }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "No se pudieron guardar los dibujos. Recargá la página y probá de nuevo." }, { status: 400 })

  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  const { supabase, user } = auth

  const { error } = await supabase
    .from("chart_drawing_sets")
    .upsert(
      { user_id: user.id, ticker: parsed.data.ticker.toUpperCase(), drawings: parsed.data.drawings },
      { onConflict: "user_id,ticker" }
    )

  if (error) return serverError("API /chart-drawings", error)
  return new NextResponse(null, { status: 204 })
}
