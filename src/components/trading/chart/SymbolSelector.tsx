"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Search, ChevronDown, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchExchangeSymbols } from "@/lib/binance/rest";
import { getPortfolio } from "@/lib/warren/positions";
import { useChartStore } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";
import { AddToWatchlistButton } from "@/components/trading/watchlist/AddToWatchlistButton";
import { addSymbolToCurrentWatchlist } from "@/lib/warren/watchlist";
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
}

export function SymbolSelector({ onSymbolSelect }: SymbolSelectorProps = {}) {
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="group flex items-center gap-2 rounded px-3 py-1.5 text-sm font-semibold hover:bg-tv-panel-hover">
        <Search className="h-3.5 w-3.5 text-tv-text-muted group-hover:text-tv-text" />
        <span className="tabular-nums">{symbol}</span>
        <ChevronDown className="h-3.5 w-3.5 text-tv-text-muted" />
      </DialogTrigger>
      <DialogContent className="max-w-md gap-0 bg-tv-panel p-0">
        <DialogHeader className="border-b border-tv-border px-4 py-3">
          <DialogTitle className="text-sm font-medium">Buscar símbolo</DialogTitle>
        </DialogHeader>
        <div className="border-b border-tv-border p-3">
          <Input
            autoFocus
            placeholder="BTC, AAPL, GGAL… (Enter para confirmar)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="bg-tv-bg"
          />
          <p className="mt-1.5 text-[10px] text-tv-text-muted">
            Buscá cripto, acciones o CEDEARs. Enter carga el ticker directamente.
          </p>
        </div>
        <ScrollArea className="h-[400px]">
          <div className="flex flex-col">
            <SectionHeader title="Acciones / Portfolio" />
            
            {isSearching && (
              <div className="flex items-center justify-center gap-2 p-4 text-xs text-tv-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Searching Yahoo...</span>
              </div>
            )}

            {!isSearching && query.length < 2 && filteredPortfolio.map((ticker) => (
              <TickerRow 
                key={`port-${ticker}`}
                symbol={ticker} 
                subtitle="Portfolio" 
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

            <SectionHeader title="Crypto (Binance)" />
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
      </DialogContent>
    </Dialog>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="bg-tv-bg-secondary px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-tv-text-dim border-b border-tv-border">
      {title}
    </div>
  );
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
    <div className={cn(
      "flex items-center justify-between border-b border-tv-border px-4 py-2 text-xs hover:bg-tv-panel-hover",
      active && "bg-tv-panel-hover"
    )}>
      <button type="button" onClick={onClick} className="flex flex-1 flex-col gap-0.5 text-left">
        <span className="font-semibold text-tv-text">{symbol}</span>
        <span className="text-[10px] text-tv-text-muted">{subtitle}</span>
      </button>
      <div className="flex items-center gap-2">
        {exchange && <span className="text-[10px] text-tv-text-muted">{exchange}</span>}
        {showAddButton && <AddToWatchlistButton symbol={symbol} />}
      </div>
    </div>
  );
}
