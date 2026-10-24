// lightweight-charts-drawing 0.6.2 hit-tests drawings with mouse-sized constants (a line
// within 6px, a handle within 12px, a drag after 3px) and has no option for touch. This
// install step makes them finger-sized when the pointer is a touch; the mouse keeps the
// library's sizes (odd/tasks/grafico-celular.md S4). It fails the install when the library
// is not the one it was written for, so an upgrade cannot silently drop the patch. Only the ES
// build is patched: it is what Next and vitest import (the package's "import" export).
import { readFileSync, writeFileSync } from 'node:fs'

const VERSION = '0.6.2'
const MARK = '/* warren: touch sizes */'
// The package directory can be passed for tests; the install runs it on node_modules.
const lib = process.argv[2]
  ? new URL(`file://${process.argv[2].replace(/\/?$/, '/')}`)
  : new URL('../node_modules/lightweight-charts-drawing/', import.meta.url)
const file = new URL('dist/lightweight-charts-drawing.es.js', lib)

const REVIEW = 'review scripts/patch-drawing-lib.mjs against the new version'
const fail = (why) => {
  console.error(`patch-drawing-lib: ${why}.`)
  process.exit(1)
}

let version, src
try {
  version = JSON.parse(readFileSync(new URL('package.json', lib), 'utf8')).version
  src = readFileSync(file, 'utf8')
} catch {
  fail('lightweight-charts-drawing is not installed')
}
if (src.includes(MARK)) process.exit(0)
if (version !== VERSION) fail(`written for lightweight-charts-drawing ${VERSION}, found ${version}; ${REVIEW}`)

const EDITS = [
  ['const et = 6, L = 6, Jn = 9;', 'let et = 6, L = 6, Jn = 9;'],
  ['const ot = et + L;', `let ot = et + L;
${MARK}
function warrenPointerSize(e) {
  if (typeof e.pointerType !== "string") return; // a dblclick keeps the sizes of the press before it
  const touch = e.pointerType === "touch";
  et = touch ? 10 : 6, L = touch ? 14 : 6, ot = et + L, da = touch ? 8 : 3;
}`],
  ['const da = 3, nr = 5, ya = 2, pa = 50;', 'let da = 3;\nconst nr = 5, ya = 2, pa = 50;'],
  ['  onHover(t) {\n    var l, s;\n', '  onHover(t) {\n    var l, s;\n    warrenPointerSize(t);\n'],
  ['  onPointerDown(t) {\n', '  onPointerDown(t) {\n    warrenPointerSize(t);\n'],
  ['  onDoubleClick(t) {\n', '  onDoubleClick(t) {\n    warrenPointerSize(t);\n'],
]
for (const [from, to] of EDITS) {
  const found = src.split(from).length - 1
  if (found !== 1) fail(`expected "${from.split('\n')[0].trim()}" once, found it ${found} times; ${REVIEW}`)
  src = src.replace(from, to)
}
writeFileSync(file, src)
console.log(`patch-drawing-lib: touch sizes applied to lightweight-charts-drawing ${version}`)
