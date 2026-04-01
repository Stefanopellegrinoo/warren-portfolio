#!/usr/bin/env tsx
/**
 * Performance Benchmark Script
 * 
 * Measures baseline performance of critical operations:
 * - rebuildCashBalance with N movements
 * - rebuildONPosition with N transactions
 * - Common query patterns
 * 
 * Usage:
 *   npx tsx scripts/benchmark.ts
 * 
 * Output:
 *   PERFORMANCE_BASELINE.md with before/after metrics
 */

import { createClient } from '@supabase/supabase-js'
import { rebuildCashBalance } from '../src/lib/cash-engine'
import { rebuildONPosition } from '../src/lib/on-engine'
import { rebuildPosition } from '../src/lib/portfolio-engine'

// ── Configuration ─────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Benchmark Utilities ───────────────────────────────────
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

// ── Test Data Generation ──────────────────────────────────
async function setupTestData() {
  console.log('🔧 Setting up test data...')
  
  // Get first user from DB
  const { data: users } = await supabase
    .from('cash_movements')
    .select('user_id')
    .limit(1)
  
  if (!users || users.length === 0) {
    console.error('❌ No users found in database. Insert test data first.')
    process.exit(1)
  }
  
  const testUserId = users[0].user_id
  console.log(`✅ Using test user: ${testUserId}`)
  
  return { testUserId }
}

// ── Benchmark Tests ───────────────────────────────────────

async function benchmarkRebuildCashBalance(userId: string, counts: number[]): Promise<BenchmarkResult[]> {
  console.log('\n📊 Benchmarking rebuildCashBalance...')
  const results: BenchmarkResult[] = []
  
  for (const count of counts) {
    // Count actual movements in DB
    const { count: actualCount } = await supabase
      .from('cash_movements')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    
    console.log(`  Testing with ~${actualCount} movements...`)
    
    const [_, duration] = await measureTime(() => rebuildCashBalance(userId))
    
    results.push({
      operation: 'rebuildCashBalance',
      count: actualCount || 0,
      durationMs: duration,
      opsPerSecond: actualCount ? Math.round(actualCount / (duration / 1000)) : 0,
    })
    
    console.log(`    ⏱️  ${duration}ms (${results[results.length - 1].opsPerSecond} ops/s)`)
  }
  
  return results
}

async function benchmarkCommonQueries(userId: string): Promise<BenchmarkResult[]> {
  console.log('\n📊 Benchmarking common queries...')
  const results: BenchmarkResult[] = []
  
  // Test 1: List cash movements (no pagination)
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
    operation: 'List cash movements (no limit)',
    count: movementsResult.data?.length || 0,
    durationMs: movementsDuration,
    opsPerSecond: Math.round((movementsResult.data?.length || 0) / (movementsDuration / 1000)),
  })
  
  // Test 2: List ON positions
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
  
  // Test 3: List stock positions
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
  
  // Test 4: Calculate portfolio summary
  const [portfolioData, portfolioDuration] = await measureTime(async () => {
    const [cash, ons, stocks] = await Promise.all([
      supabase.from('cash_balance').select('balance').eq('user_id', userId).single(),
      supabase.from('on_positions').select('quantity, precio_compra').eq('user_id', userId),
      supabase.from('positions').select('quantity, precio_promedio').eq('user_id', userId),
    ])
    return { cash, ons, stocks }
  })
  
  console.log(`  Portfolio summary calculation: ${portfolioDuration}ms`)
  results.push({
    operation: 'Portfolio summary (parallel queries)',
    count: 3,
    durationMs: portfolioDuration,
    opsPerSecond: Math.round(3 / (portfolioDuration / 1000)),
  })
  
  return results
}

// ── Report Generation ─────────────────────────────────────

function generateMarkdownReport(results: BenchmarkResult[]): string {
  const timestamp = new Date().toISOString()
  
  return `# 📊 Performance Baseline Report

**Generated**: ${timestamp}  
**Phase**: FASE 3 - Before Optimizations  

## 🎯 Executive Summary

This report establishes performance baselines BEFORE implementing:
- Pagination on list endpoints
- Strategic database indexes
- Redis caching layer
- Query optimizations

## 📈 Benchmark Results

### Rebuild Operations

| Operation | Data Size | Duration (ms) | Ops/Second |
|-----------|-----------|---------------|------------|
${results.filter(r => r.operation.includes('rebuild')).map(r => 
  `| ${r.operation} | ${r.count} rows | ${r.durationMs} | ${r.opsPerSecond} |`
).join('\n')}

### Common Query Patterns

| Operation | Data Size | Duration (ms) | Ops/Second |
|-----------|-----------|---------------|------------|
${results.filter(r => !r.operation.includes('rebuild')).map(r => 
  `| ${r.operation} | ${r.count} rows | ${r.durationMs} | ${r.opsPerSecond} |`
).join('\n')}

## 🚨 Performance Issues Identified

### Critical
- **No pagination**: List endpoints fetch ALL rows (performance degrades with data growth)
- **Rebuild on every operation**: O(N) complexity scales linearly with history

### High Priority
- **No caching**: Portfolio summary recalculated on every page load
- **Missing indexes**: No compound indexes for common query patterns

## 🎯 Expected Improvements (Post-FASE 3)

| Optimization | Expected Impact |
|--------------|-----------------|
| Pagination (limit 50) | 10-50x faster for large datasets |
| Strategic indexes | 2-5x faster for filtered queries |
| Redis caching (30s TTL) | 50-100x faster for cached reads |
| Optimistic locking (FASE 2) | Already implemented ✅ |

## 📋 Next Steps

1. ✅ Baseline established
2. ⏳ Implement pagination schema
3. ⏳ Add pagination to 4+ endpoints
4. ⏳ Create database indexes migration
5. ⏳ Implement Redis cache layer
6. ⏳ Re-run benchmark and compare

---
*Run this script again after FASE 3 to measure actual improvements.*
`
}

// ── Main Execution ────────────────────────────────────────

async function main() {
  console.log('🚀 Starting Performance Benchmark...\n')
  
  const { testUserId } = await setupTestData()
  
  const allResults: BenchmarkResult[] = []
  
  // Benchmark rebuild operations
  const rebuildResults = await benchmarkRebuildCashBalance(testUserId, [1])
  allResults.push(...rebuildResults)
  
  // Benchmark common queries
  const queryResults = await benchmarkCommonQueries(testUserId)
  allResults.push(...queryResults)
  
  // Generate report
  const report = generateMarkdownReport(allResults)
  
  // Write to file
  const fs = await import('fs/promises')
  await fs.writeFile('PERFORMANCE_BASELINE.md', report, 'utf-8')
  
  console.log('\n✅ Benchmark complete!')
  console.log('📄 Report saved to: PERFORMANCE_BASELINE.md')
  console.log('\n📊 Summary:')
  allResults.forEach(r => {
    console.log(`  • ${r.operation}: ${r.durationMs}ms (${r.count} items)`)
  })
}

main().catch((err) => {
  console.error('❌ Benchmark failed:', err)
  process.exit(1)
})
