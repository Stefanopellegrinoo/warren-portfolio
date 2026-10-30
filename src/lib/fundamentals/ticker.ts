/**
 * The asset page's ticker rule, for the server and the browser alike (odd/tasks/asset-page.md L29):
 * no imports, so the client bundle can take it. Like the search route's cap, but strict: these
 * become Redis keys, source requests and ?vs= entries.
 */
const TICKER = /^(BCBA:)?[A-Z0-9][A-Z0-9.-]{0,14}$/

/** `MELI`, `bcba:ggal`, `GGAL.BA` → `MELI`, `BCBA:GGAL`, `BCBA:GGAL`; null for anything else. */
export function parseTicker(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/^([A-Z0-9-]+)\.BA$/, 'BCBA:$1')
  return TICKER.test(t) ? t : null
}
