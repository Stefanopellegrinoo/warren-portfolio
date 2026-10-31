// Which BYMA peso line a stored watchlist symbol means. One shared rule for
// Mercado's rows, its star and its counts (design "Lists").
//
// The app's convention: the portfolio stores a CEDEAR as plain `AAPL` and a
// local share as `BCBA:GGAL`; Gráficos' Yahoo search stores `GGAL.BA` for the
// BYMA share and plain `GGAL` for the NASDAQ ADR.

export type ListLine =
  | { kind: 'local'; line: string } // a BYMA local share; `line` = its peso-line symbol (e.g. 'GGAL')
  | { kind: 'cedear'; line: string } // a CEDEAR; `line` = its peso-line symbol (e.g. 'AAPL')
  | { kind: 'adr'; line: string } // a plain ticker that is the US ADR of local share `line`; never priced at the share's price
  | { kind: 'none' } // not on BYMA (e.g. 'BTCUSDT', a US stock with no CEDEAR)

/** The board's peso-line symbols, upper-case. */
export interface BoardSymbols {
  locals: ReadonlySet<string>
  cedears: ReadonlySet<string>
}

const BCBA_PREFIX = 'BCBA:'
const BA_SUFFIX = '.BA'

export function lineOf(stored: string, board: BoardSymbols): ListLine {
  const s = stored.trim().toUpperCase()

  const byma = s.startsWith(BCBA_PREFIX)
    ? s.slice(BCBA_PREFIX.length)
    : s.endsWith(BA_SUFFIX)
      ? s.slice(0, -BA_SUFFIX.length)
      : null

  if (byma !== null) {
    if (board.locals.has(byma)) return { kind: 'local', line: byma }
    if (board.cedears.has(byma)) return { kind: 'cedear', line: byma }
    return { kind: 'none' }
  }

  if (board.cedears.has(s)) return { kind: 'cedear', line: s }
  if (board.locals.has(s)) return { kind: 'adr', line: s }
  return { kind: 'none' }
}

/** The symbol Mercado writes when adding this line to a list. */
export function storedSymbolFor(kind: 'local' | 'cedear', line: string): string {
  return kind === 'local' ? `${BCBA_PREFIX}${line}` : line
}

/** Every stored spelling that means this line (the star's "held" check and removal). */
export function spellingsOf(kind: 'local' | 'cedear', line: string): string[] {
  return kind === 'local' ? [`${BCBA_PREFIX}${line}`, `${line}${BA_SUFFIX}`] : [line]
}
