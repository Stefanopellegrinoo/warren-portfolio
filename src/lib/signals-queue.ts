import { Queue } from 'bullmq'
import Redis from 'ioredis'

export const SIGNALS_QUEUE_NAME = 'signals-evaluation'

function parseRedisUrl(url: string) {
  if (!url) throw new Error('REDIS_URL is not defined')
  const parsed = new URL(url.startsWith('redis://') ? url : `redis://${url}`)
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6380', 10),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    maxRetriesPerRequest: null,
  }
}

let signalsQueue: Queue | null = null

export function getSignalsQueue(): Queue {
  if (!signalsQueue) {
    signalsQueue = new Queue(SIGNALS_QUEUE_NAME, {
      connection: new Redis(parseRedisUrl(process.env.REDIS_URL || ''))
    })
  }
  return signalsQueue
}

export async function scheduleSignalsEvaluationJobs(): Promise<void> {
  const queue = getSignalsQueue()
  await queue.add('evaluate-open', {}, {
    repeat: { pattern: '30 13 * * 1-5' },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })
  await queue.add('evaluate-mid', {}, {
    repeat: { pattern: '30 16 * * 1-5' },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })
  await queue.add('evaluate-close', {}, {
    repeat: { pattern: '30 19 * * 1-5' },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })
  console.log('[Queue] Signals evaluation jobs scheduled (open, mid, close)')
}

export async function enqueueImmediateEvaluation(userId?: string, ticker?: string): Promise<void> {
  const queue = getSignalsQueue()
  await queue.add('evaluate-immediate', { userId, ticker }, {
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  })
}
