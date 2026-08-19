import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockEnsureRedisConnected = vi.fn()
vi.mock('../redis', () => ({
  ensureRedisConnected: (...args: unknown[]) => mockEnsureRedisConnected(...args),
}))

const mockScheduleRepeatingPriceJob = vi.fn()
const mockScheduleDailySnapshotJob = vi.fn()
const mockScheduleTickerAuditJob = vi.fn()
vi.mock('../queue', () => ({
  scheduleRepeatingPriceJob: (...args: unknown[]) => mockScheduleRepeatingPriceJob(...args),
  scheduleDailySnapshotJob: (...args: unknown[]) => mockScheduleDailySnapshotJob(...args),
  scheduleTickerAuditJob: (...args: unknown[]) => mockScheduleTickerAuditJob(...args),
}))

const mockScheduleSignalsEvaluationJobs = vi.fn()
vi.mock('../signals-queue', () => ({
  scheduleSignalsEvaluationJobs: (...args: unknown[]) => mockScheduleSignalsEvaluationJobs(...args),
}))

// ── Import after mocks are set up ────────────────────────────────────────────

const { ensureRedisAndScheduleJobs, resolveStartupOutcome } = await import('../worker-startup')

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ensureRedisAndScheduleJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureRedisConnected.mockResolvedValue(true)
    mockScheduleRepeatingPriceJob.mockResolvedValue(undefined)
    mockScheduleDailySnapshotJob.mockResolvedValue(undefined)
    mockScheduleTickerAuditJob.mockResolvedValue(undefined)
    mockScheduleSignalsEvaluationJobs.mockResolvedValue(undefined)
  })

  it('schedules the daily portfolio snapshot alongside the other jobs', async () => {
    // Act
    await ensureRedisAndScheduleJobs()

    // Assert — without this the max-drawdown series never gets written
    expect(mockScheduleDailySnapshotJob).toHaveBeenCalledTimes(1)
  })

  it('schedules the weekly ticker identity audit alongside the other jobs', async () => {
    // Act
    await ensureRedisAndScheduleJobs()

    // Assert — without this held tickers never get re-verified against Yahoo
    expect(mockScheduleTickerAuditJob).toHaveBeenCalledTimes(1)
  })

  it('does not schedule the snapshot when Redis is unreachable', async () => {
    // Arrange
    mockEnsureRedisConnected.mockResolvedValue(false)

    // Act
    await ensureRedisAndScheduleJobs()

    // Assert
    expect(mockScheduleDailySnapshotJob).not.toHaveBeenCalled()
    expect(mockScheduleTickerAuditJob).not.toHaveBeenCalled()
  })

  it('returns ok and schedules both jobs when Redis is reachable', async () => {
    // Act
    const result = await ensureRedisAndScheduleJobs()

    // Assert
    expect(result).toEqual({ ok: true })
    expect(mockScheduleRepeatingPriceJob).toHaveBeenCalledTimes(1)
    expect(mockScheduleRepeatingPriceJob).toHaveBeenCalledWith(5)
    expect(mockScheduleSignalsEvaluationJobs).toHaveBeenCalledTimes(1)
  })

  it('returns redis-unreachable and does NOT schedule when Redis is down', async () => {
    // Arrange
    mockEnsureRedisConnected.mockResolvedValue(false)

    // Act
    const result = await ensureRedisAndScheduleJobs()

    // Assert
    expect(result).toEqual({ ok: false, reason: 'redis-unreachable' })
    expect(mockScheduleRepeatingPriceJob).not.toHaveBeenCalled()
    expect(mockScheduleSignalsEvaluationJobs).not.toHaveBeenCalled()
  })

  it('returns schedule-failed with the error when signals scheduling throws', async () => {
    // Arrange
    const boom = new Error('queue.add exploded')
    mockScheduleSignalsEvaluationJobs.mockRejectedValue(boom)

    // Act
    const result = await ensureRedisAndScheduleJobs()

    // Assert
    expect(result).toEqual({ ok: false, reason: 'schedule-failed', error: boom })
    // Price job was attempted before the signals scheduling blew up
    expect(mockScheduleRepeatingPriceJob).toHaveBeenCalledTimes(1)
  })
})

describe('resolveStartupOutcome', () => {
  it('keeps the worker running when startup succeeded', () => {
    // Act
    const outcome = resolveStartupOutcome({ ok: true })

    // Assert — no exit, so main() falls through to the initial price fetch
    expect(outcome.exit).toBe(false)
  })

  it('exits 1 when Redis is unreachable', () => {
    // Act
    const outcome = resolveStartupOutcome({ ok: false, reason: 'redis-unreachable' })

    // Assert — non-zero exit is what makes Docker restart:unless-stopped retry
    expect(outcome).toEqual({
      exit: true,
      code: 1,
      message: '[Worker] Redis unreachable — cannot schedule jobs, exiting for restart',
    })
  })

  it('exits 1 and surfaces the Error message when scheduling failed', () => {
    // Arrange
    const error = new Error('queue.add exploded')

    // Act
    const outcome = resolveStartupOutcome({ ok: false, reason: 'schedule-failed', error })

    // Assert
    expect(outcome.exit).toBe(true)
    expect(outcome).toMatchObject({ code: 1 })
    expect(outcome.exit && outcome.message).toContain('queue.add exploded')
  })

  it('surfaces non-Error throws without crashing on .message', () => {
    // Arrange — a thrown string has no .message; the mapping must not blow up
    // Act
    const outcome = resolveStartupOutcome({
      ok: false,
      reason: 'schedule-failed',
      error: 'redis handshake timeout',
    })

    // Assert
    expect(outcome.exit).toBe(true)
    expect(outcome.exit && outcome.message).toContain('redis handshake timeout')
  })
})
