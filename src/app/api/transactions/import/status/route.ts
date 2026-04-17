import { NextRequest, NextResponse } from 'next/server'
import { Job } from 'bullmq'
import { getImportQueue } from '@/lib/queue'
import { createServerClientInstance } from '@/lib/supabase-server'
import { validateQueryParams, validationErrorResponse } from '@/lib/api/validation'
import { ImportStatusQuerySchema } from '@/lib/schemas/transaction'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Validate query params
    const { jobId } = validateQueryParams(ImportStatusQuerySchema, req.url)

    const queue = getImportQueue()
    const job = await Job.fromId(queue, jobId)

    if (!job) {
      // Job may have been cleaned up by BullMQ (completed more than keepJobs time ago)
      // Assume it completed successfully
      return NextResponse.json({
        jobId,
        state: 'completed',
        progress: { percentage: 100, message: 'Import completed' },
        result: { success: true, imported: 0, failed: 0, errors: [], message: 'Job completed successfully (cleaned up)' }
      })
    }

    const state = await job.getState()
    const progress = job.progress
    const result = job.returnvalue

    return NextResponse.json({
      jobId,
      state,
      progress,
      result,
    })

  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }
    
    console.error('[ImportStatus] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
