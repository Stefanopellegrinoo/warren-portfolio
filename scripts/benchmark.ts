#!/usr/bin/env tsx
/**
 * Performance Benchmark Script
 * 
 * Measures baseline performance of critical operations:
 * - rebuildCashBalance
 * - Common query patterns
 * 
 * Usage:
 *   npx tsx scripts/benchmark.ts
 */

import { createClient } from '@supabase/supabase-js'
import { rebuildCashBalance } from '../src/lib/cash-engine'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface BenchmarkResult {
  operation: string
  count: number
  durationMs: number
  opsPerSecond: number
}

async function measureTime<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = Date.now()
  const result = await fn()
  const duration = Date.now() - start
  return [result, duration]
}

async function setupTestData() {
  const { data: users } = await supabase
    .from('cash_movements')
    .select('user_id')
    .limit(1)
  
  if (!users || users.length === 0) {
    console.error('No users found in database.')
    process.exit(1)
  }
  
  const testUserId = users[0].user_id
  return { testUserId }
}

async function benchmarkRebuildCashBalance(userId: string, counts: number[]): Promise<BenchmarkResult[]> {
  console.log('\nBenchmarking rebuildCashBalance...')
  const results: BenchmarkResult[] = []
  
  for (const _count of counts) {
    const { count: actualCount } = await supabase
      .from('cash_movements')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    
    console.log(`  Testing with ${actualCount || 0} movements...`)
    
    const [_, duration] = await measureTime(() => rebuildCashBalance(userId))
    
    results.push({
      operation: 'rebuildCashBalance',
      count: actualCount || 0,
      durationMs: duration,
      opsPerSecond: actualCount ? Math.round(actualCount / (duration / 1000)) : 0,
    })
    
    console.log(`    ${duration}ms (${results[results.length - 1].opsPerSecond} ops/s)`)
  }
  
  return results
}

async function benchmarkCommonQueries(userId: string): Promise<BenchmarkResult[]> {
  console.log('\nBenchmarking common queries...')
  const results: BenchmarkResult[] = []
  
  const [movementsResult, movementsDuration] = await measureTime(async () => {
    const result = await supabase
      .from('cash_movements')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
    return result
  })
  
  console.log(`  List cash movements: ${movementsDuration}ms (${movementsResult.data?.length || 0} rows)`)
  results.push({
    operation: 'List cash movements',
    count: movementsResult.data?.length || 0,
    durationMs: movementsDuration,
    opsPerSecond: Math.round((movementsResult.data?.length || 0) / (movementsDuration / 1000)),
  })
  
  const [onResult, onDuration] = await measureTime(async () => {
    const result = await supabase
      .from('on_positions')
      .select('*')
      .eq('user_id', userId)
    return result
  })
  
  console.log(`  List ON positions: ${onDuration}ms (${onResult.data?.length || 0} rows)`)
  results.push({
    operation: 'List ON positions',
    count: onResult.data?.length || 0,
    durationMs: onDuration,
    opsPerSecond: Math.round((onResult.data?.length || 0) / (onDuration / 1000)),
  })
  
  const [positionsResult, positionsDuration] = await measureTime(async () => {
    const result = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
    return result
  })
  
  console.log(`  List stock positions: ${positionsDuration}ms (${positionsResult.data?.length || 0} rows)`)
  results.push({
    operation: 'List stock positions',
    count: positionsResult.data?.length || 0,
    durationMs: positionsDuration,
    opsPerSecond: Math.round((positionsResult.data?.length || 0) / (positionsDuration / 1000)),
  })
  
  return results
}

async function main() {
  console.log('Starting Performance Benchmark...\n')
  
  const { testUserId } = await setupTestData()
  const allResults: BenchmarkResult[] = []
  
  const rebuildResults = await benchmarkRebuildCashBalance(testUserId, [1])
  allResults.push(...rebuildResults)
  
  const queryResults = await benchmarkCommonQueries(testUserId)
  allResults.push(...queryResults)
  
  console.log('\nSummary:')
  allResults.forEach(r => {
    console.log(`  • ${r.operation}: ${r.durationMs}ms (${r.count} items)`)
  })
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
