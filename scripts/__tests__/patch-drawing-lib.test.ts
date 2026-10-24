import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(__dirname, '..', 'patch-drawing-lib.mjs')
// The lines of lightweight-charts-drawing 0.6.2 the patch rewrites, each once.
const LIB = [
  'const et = 6, L = 6, Jn = 9;',
  'const ot = et + L;',
  'const da = 3, nr = 5, ya = 2, pa = 50;',
  'class DrawingManager {',
  '  onHover(t) {\n    var l, s;\n    if (this.gesture || t.buttons) return;\n  }',
  '  onPointerDown(t) {\n    if (t.button !== 0) return;\n  }',
  '  onDoubleClick(t) {\n    var o, i;\n  }',
  '}',
].join('\n')

const dirs: string[] = []
afterEach(() => { dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })) })

function lib(version: string, source = LIB) {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-lib-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }))
  writeFileSync(join(dir, 'dist', 'lightweight-charts-drawing.es.js'), source)
  const run = () => spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  const read = () => readFileSync(join(dir, 'dist', 'lightweight-charts-drawing.es.js'), 'utf8')
  return { run, read }
}

describe('patch-drawing-lib', () => {
  it('makes the hit sizes follow the pointer on every pointer handler', () => {
    const { run, read } = lib('0.6.2')

    const result = run()

    expect(result.status).toBe(0)
    const src = read()
    expect(src).toContain('let et = 6, L = 6, Jn = 9;')
    expect(src).toContain('let da = 3;')
    expect(src).toContain('et = touch ? 10 : 6, L = touch ? 14 : 6, ot = et + L, da = touch ? 8 : 3;')
    expect(src.match(/warrenPointerSize\(t\);/g)).toHaveLength(3)
  })

  it('a second install leaves the patched file as it is', () => {
    const { run, read } = lib('0.6.2')
    run()
    const once = read()

    expect(run().status).toBe(0)
    expect(read()).toBe(once)
  })

  it('fails the install on another version of the library', () => {
    const { run, read } = lib('0.7.0')

    const result = run()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('written for lightweight-charts-drawing 0.6.2, found 0.7.0')
    expect(read()).toBe(LIB)
  })

  it('fails the install when a line it rewrites is gone', () => {
    const { run, read } = lib('0.6.2', LIB.replace('const ot = et + L;', 'const ot = 12;'))

    const result = run()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('expected "const ot = et + L;" once, found it 0 times')
    expect(read()).not.toContain('warren')
  })
})
