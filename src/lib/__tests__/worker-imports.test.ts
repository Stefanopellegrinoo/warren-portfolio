// The worker runs under tsx in the Docker image, which has no tsconfig.json: an `@/` value import
// anywhere in its module graph crashes it at startup (`import type` is erased, so it is fine).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const IMPORT_RE = /^\s*(import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm

function resolveFile(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? resolve(SRC, spec.slice(2)) : resolve(dirname(from), spec)
  for (const f of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) if (existsSync(f) && f.match(/\.tsx?$/)) return f
  return null
}

function aliasedValueImports(entry: string): string[] {
  const seen = new Set<string>()
  const bad: string[] = []
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const [, , spec] of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      if (!spec.startsWith('.') && !spec.startsWith('@/')) continue
      if (spec.startsWith('@/')) bad.push(`${file.slice(SRC.length + 1)} → ${spec}`)
      const next = resolveFile(file, spec)
      if (next) walk(next)
    }
  }
  walk(entry)
  return bad
}

describe('the price worker module graph', () => {
  it('has no `@/` value import the Docker runner could not resolve', () => {
    expect(aliasedValueImports(resolve(SRC, 'lib/price-worker.ts'))).toEqual([])
  })
})
