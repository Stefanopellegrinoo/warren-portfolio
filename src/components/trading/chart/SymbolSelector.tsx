"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Search, ChevronDown, Loader2 } from "lucide-react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { TradingDialog, field } from "@/components/trading/ui";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchExchangeSymbols } from "@/lib/binance/rest";
import { getPortfolio } from "@/lib/warren/positions";
import { useChartStore } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";
import { AddToWatchlistButton } from "@/components/trading/watchlist/AddToWatchlistButton";
import type { SymbolInfo } from "@/lib/binance/types";
import type { SearchResult } from "@/lib/market-data/types";

// ── Pure utility exports (exported for unit testing) ─────────────────────────

export function buildSearchUrl(q: string): string {
  return `/api/ticker/search?q=${encodeURIComponent(q)}`
}

export async function fetchTickerSearch(q: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(buildSearchUrl(q))
    if (!res.ok) return []
    const data = await res.json()
    return data.results ?? []
  } catch {
    return []
  }
}

export function shouldFetchSearch(query: string): boolean {
  return query.length >= 2
}

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      fn(...args)
    }, delayMs)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SymbolSelectorProps {
  onSymbolSelect?: () => void;
  /** Shown next to the ticker inside the trigger (the top bar puts the quote here). */
  children?: React.ReactNode;
}

export function SymbolSelector({ onSymbolSelect, children }: SymbolSelectorProps = {}) {
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const open = useChartStore((s) => s.symbolDialogOpen);
  const setOpen = useChartStore((s) => s.setSymbolDialogOpen);

  const [query, setQuery] = useState("");
  const [allBinanceSymbols, setAllBinanceSymbols] = useState<SymbolInfo[]>([]);
  const [portfolioTickers, setPortfolioTickers] = useState<string[]>([]);

  // ── Search state ──────────────────────────────────────────────────────────
  const [yahooResults, setYahooResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Stable debounced fetch reference
  const debouncedFetch = useRef(
    debounce(async (q: string) => {
      setIsSearching(true)
      const results = await fetchTickerSearch(q)
      setYahooResults(results)
      setIsSearching(false)
    }, 300)
  ).current

  useEffect(() => {
    if (!open) return;
    if (allBinanceSymbols.length === 0) {
      fetchExchangeSymbols().then(setAllBinanceSymbols).catch(console.error);
    }
    getPortfolio()
      .then((data) => setPortfolioTickers((data.positions ?? []).map((p) => p.ticker)))
      .catch(console.error);
  }, [open, allBinanceSymbols.length]);

  useEffect(() => {
    if (query.length < 2) {
      setYahooResults([])
      setIsSearching(false)
    }
  }, [query])

  useEffect(() => {
    if (shouldFetchSearch(query)) {
      debouncedFetch(query)
    }
  }, [query, debouncedFetch])

  const filteredBinance = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return allBinanceSymbols.slice(0, 100);
    return allBinanceSymbols
      .filter(
        (s) =>
          s.symbol.includes(q) ||
          s.baseAsset.includes(q) ||
          s.quoteAsset.includes(q),
      )
      .slice(0, 100);
  }, [query, allBinanceSymbols]);

  const filteredPortfolio = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return portfolioTickers;
    return portfolioTickers.filter((t) => t.includes(q));
  }, [query, portfolioTickers]);

  function selectTicker(ticker: string) {
    setSymbol(ticker);
    const onSelect = useChartStore.getState().symbolDialogOnSelect;
    if (onSelect) {
      onSelect(ticker);
      useChartStore.setState({ symbolDialogOnSelect: null });
    }
    setOpen(false);
    setQuery("");
    onSymbolSelect?.();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const ticker = query.trim().toUpperCase();
      if (ticker) selectTicker(ticker);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => setOpen(v)}>
      <DialogTrigger
        aria-label={`Cambiar símbolo, ahora ${symbol}`}
        className="group flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-base font-semibold text-ink hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:min-h-11 max-[819px]:gap-1.5 max-[819px]:px-1"
      >
        <Search className="h-4 w-4 flex-none text-ink-3 group-hover:text-ink max-[819px]:hidden" strokeWidth={1.5} aria-hidden="true" />
        <span className="flex-none tabular-nums">{symbol}</span>
        {children}
        <ChevronDown className="h-4 w-4 flex-none text-ink-3 max-[399px]:hidden" strokeWidth={1.5} aria-hidden="true" />
      </DialogTrigger>
      <TradingDialog title="Buscar símbolo" width={448}>
        <div className="border-b border-line p-3">
          <input
            autoFocus
            aria-label="Símbolo"
            placeholder="BTC, AAPL, GGAL…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className={field}
          />
          <p className="mt-1.5 text-xs text-ink-3">
            Cripto, acciones o CEDEARs. Enter abre el ticker escrito.
          </p>
        </div>
        <ScrollArea className="h-[min(400px,60dvh)]">
          <div className="flex flex-col">
            <SectionHeader title="Acciones y cartera" />

            {isSearching && (
              <div role="status" className="flex items-center justify-center gap-2 p-4 text-[13px] text-ink-3">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <span>Buscando…</span>
              </div>
            )}

            {!isSearching && query.length < 2 && filteredPortfolio.map((ticker) => (
              <TickerRow
                key={`port-${ticker}`}
                symbol={ticker}
                subtitle="En tu cartera"
                onClick={() => selectTicker(ticker)}
                active={ticker === symbol}
              />
            ))}

            {!isSearching && query.length >= 2 && yahooResults.map((r) => (
              <TickerRow
                key={`yahoo-${r.symbol}`}
                symbol={r.symbol}
                subtitle={r.shortname}
                exchange={r.exchange}
                onClick={() => selectTicker(r.symbol)}
                active={r.symbol === symbol}
                showAddButton
              />
            ))}

            <SectionHeader title="Cripto (Binance)" />
            {filteredBinance.map((s) => (
              <TickerRow
                key={`binance-${s.symbol}`}
                symbol={s.symbol}
                subtitle={`${s.baseAsset} / ${s.quoteAsset}`}
                onClick={() => selectTicker(s.symbol)}
                active={s.symbol === symbol}
              />
            ))}
          </div>
        </ScrollArea>
      </TradingDialog>
    </Dialog>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <h3 className="border-b border-line bg-surface-2 px-4 py-1.5 text-[13px] font-medium text-ink-2">{title}</h3>;
}

function TickerRow({
  symbol,
  subtitle,
  exchange,
  onClick,
  active,
  showAddButton
}: {
  symbol: string;
  subtitle: string;
  exchange?: string;
  onClick: () => void;
  active: boolean;
  showAddButton?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2 border-b border-line px-4 hover:bg-hover", active && "bg-hover")}>
      <button type="button" onClick={onClick} aria-current={active || undefined} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1.5 text-left">
        <span className="text-sm font-medium text-ink">{symbol}</span>
        <span className="truncate text-xs text-ink-3">{subtitle}</span>
      </button>
      <div className="flex flex-none items-center gap-2">
        {exchange && <span className="text-xs text-ink-3">{exchange}</span>}
        {showAddButton && <AddToWatchlistButton symbol={symbol} />}
      </div>
    </div>
  );
}
