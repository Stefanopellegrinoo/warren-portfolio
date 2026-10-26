// The chart page is a client bundle: a module that reaches yahoo-finance2 (even through a dynamic
// import) drags Node built-ins into it and the page stops compiling ("Can't resolve 'net'").
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm

function resolveFile(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? resolve(SRC, spec.slice(2)) : resolve(dirname(from), spec)
  for (const f of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) if (existsSync(f) && f.match(/\.tsx?$/)) return f
  return null
}

/** Every path from `entry` that ends in `pkg`, as "a → b → pkg". */
function pathsTo(entry: string, pkg: string): string[] {
  const seen = new Set<string>()
  const found: string[] = []
  const walk = (file: string, trail: string[]) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2]
      if (spec === pkg) found.push([...trail, file.slice(SRC.length + 1), pkg].join(' → '))
      if (!spec.startsWith('.') && !spec.startsWith('@/')) continue
      const next = resolveFile(file, spec)
      if (next) walk(next, [...trail, file.slice(SRC.length + 1)])
    }
  }
  walk(entry, [])
  return found
}

describe('the chart page client bundle', () => {
  it('never reaches yahoo-finance2', () => {
    expect(pathsTo(resolve(SRC, 'app/trading/page.tsx'), 'yahoo-finance2')).toEqual([])
  })
})
