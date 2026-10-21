/** Notice for positions with no quote: they are left out of the totals. Renders nothing for 0 or old cached payloads. */
export default function UnpricedNotice({ count, tickers }: { count?: number; tickers?: string[] }) {
  const n = count ?? 0
  if (n <= 0) return null
  const list = tickers && tickers.length > 0 ? ` (${tickers.join(', ')})` : ''
  const text = n === 1
    ? `1 posición sin precio${list} — no está incluida en el total`
    : `${n} posiciones sin precio${list} — no están incluidas en el total`
  return (
    <div role="status" className="mb-6 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-amber text-xs font-mono animate-fade-in">
      {text}
    </div>
  )
}
