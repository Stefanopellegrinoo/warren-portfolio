import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireUser, isAuthFailure } from "@/lib/api-auth"
import { serverError } from "@/lib/api/errors"
import type { ChartDrawing } from "@/lib/types/drawings"
import { INVALID_JSON } from '@/lib/api/validation'

const querySchema = z.object({
  ticker: z.string().min(1).max(20),
})

const pointSchema = z.object({
  time: z.number().int().positive(),
  price: z.number().finite(),
})

const baseFields = {
  ticker: z.string().min(1).max(20),
  style: z.record(z.string(), z.unknown()).optional().default({}),
  label: z.string().optional(),
}

// Per-type strict point count — discriminated union ensures clients can't
// send a channel with 1 point or a trendline with 3.
const bodySchema = z.discriminatedUnion("type", [
  z.object({ ...baseFields, type: z.literal("hline"),          points: z.array(pointSchema).length(1) }),
  z.object({ ...baseFields, type: z.literal("horizontal_ray"), points: z.array(pointSchema).length(1) }),
  z.object({ ...baseFields, type: z.literal("trendline"),      points: z.array(pointSchema).length(2) }),
  z.object({ ...baseFields, type: z.literal("fibonacci"),      points: z.array(pointSchema).length(2) }),
  z.object({ ...baseFields, type: z.literal("ray"),            points: z.array(pointSchema).length(2) }),
  z.object({ ...baseFields, type: z.literal("price_range"),    points: z.array(pointSchema).length(2) }),
  z.object({ ...baseFields, type: z.literal("arrow"),          points: z.array(pointSchema).length(2) }),
  z.object({ ...baseFields, type: z.literal("channel"),        points: z.array(pointSchema).length(3) }),
])

 
function rowToDrawing(r: any): ChartDrawing {
  return {
    id: r.id,
    userId: r.user_id,
    ticker: r.ticker,
    type: r.type,
    points: r.points,
    style: r.style ?? {},
    label: r.label ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({ ticker: url.searchParams.get("ticker") })
  if (!parsed.success) {
    return NextResponse.json({ error: "Ingresá un ticker válido" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("chart_drawings")
    .select("*")
    .eq("user_id", user.id)
    .eq("ticker", parsed.data.ticker.toUpperCase())
    .order("created_at", { ascending: true })

  if (error) return serverError("API /drawings", error)
  return NextResponse.json((data ?? []).map(rowToDrawing))
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: INVALID_JSON }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "No se pudo guardar el dibujo. Recargá la página y probá de nuevo." }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("chart_drawings")
    .insert({
      user_id: user.id,
      ticker: parsed.data.ticker.toUpperCase(),
      type: parsed.data.type,
      points: parsed.data.points,
      style: parsed.data.style,
      ...(parsed.data.label != null ? { label: parsed.data.label } : {}),
    })
    .select()
    .single()

  if (error) return serverError("API /drawings", error)
  return NextResponse.json(rowToDrawing(data), { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth

  const url = new URL(req.url)
  const ticker = url.searchParams.get("ticker")
  if (!ticker) return NextResponse.json({ error: "Ingresá el ticker" }, { status: 400 })

  const { error } = await supabase
    .from("chart_drawings")
    .delete()
    .eq("user_id", user.id)
    .eq("ticker", ticker.toUpperCase())

  if (error) return serverError("API /drawings", error)
  return new NextResponse(null, { status: 204 })
}
