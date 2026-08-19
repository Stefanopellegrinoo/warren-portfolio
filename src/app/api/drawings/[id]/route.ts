import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireUser, isAuthFailure } from "@/lib/api-auth"
import type { ChartDrawing } from "@/lib/types/drawings"

const pointSchema = z.object({
  time: z.number().int().positive(),
  price: z.number().finite(),
})

const patchSchema = z
  .object({
    points: z.array(pointSchema).min(1).max(3).optional(),
    style: z.record(z.string(), z.unknown()).optional(),
    label: z.string().optional(),
  })
  .refine((o) => o.points !== undefined || o.style !== undefined || o.label !== undefined, {
    message: "nothing to update",
  })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await params

  const update: Record<string, unknown> = {}
  if (parsed.data.points !== undefined) update.points = parsed.data.points
  if (parsed.data.style !== undefined) update.style = parsed.data.style
  if (parsed.data.label !== undefined) update.label = parsed.data.label

  const { data, error } = await supabase
    .from("chart_drawings")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id) // belt-and-suspenders with RLS
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(rowToDrawing(data))
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { supabase, user } = auth
  const { id } = await params

  const { error } = await supabase
    .from("chart_drawings")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
