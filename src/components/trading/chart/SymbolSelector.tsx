"use client";

import { useEffect, useState, useMemo } from "react";
import { Search, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchExchangeSymbols } from "@/lib/binance/rest";
import { getPortfolio } from "@/lib/warren/positions";
import { useChartStore } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";
import type { SymbolInfo } from "@/lib/binance/types";

export function SymbolSelector() {
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const addToWatchlist = useChartStore((s) => s.addToWatchlist);
  const dataSource = useChartStore((s) => s.dataSource);
  const open = useChartStore((s) => s.symbolDialogOpen);
  const setOpen = useChartStore((s) => s.setSymbolDialogOpen);

  const [query, setQuery] = useState("");
  const [allSymbols, setAllSymbols] = useState<SymbolInfo[]>([]);
  const [portfolioTickers, setPortfolioTickers] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    if (dataSource === "binance" && allSymbols.length === 0) {
      fetchExchangeSymbols().then(setAllSymbols).catch(console.error);
    }
    if (dataSource === "yahoo") {
      getPortfolio()
        .then((data) => setPortfolioTickers((data.positions ?? []).map((p) => p.ticker)))
        .catch(console.error);
    }
  }, [open, dataSource, allSymbols.length]);

  const filteredBinance = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return allSymbols.slice(0, 100);
    return allSymbols
      .filter(
        (s) =>
          s.symbol.includes(q) ||
          s.baseAsset.includes(q) ||
          s.quoteAsset.includes(q),
      )
      .slice(0, 100);
  }, [query, allSymbols]);

  const filteredYahoo = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return portfolioTickers;
    return portfolioTickers.filter((t) => t.includes(q));
  }, [query, portfolioTickers]);

  function selectTicker(ticker: string) {
    setSymbol(ticker);
    if (dataSource === "binance") addToWatchlist(ticker);
    setOpen(false);
    setQuery("");
  }

  function handleYahooKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
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
          <DialogTitle className="text-sm font-medium">
            {dataSource === "yahoo" ? "Buscar acción / CEDEAR" : "Buscar símbolo"}
          </DialogTitle>
        </DialogHeader>
        <div className="border-b border-tv-border p-3">
          <Input
            autoFocus
            placeholder={dataSource === "yahoo" ? "GGAL, MELI, AAPL… (Enter para confirmar)" : "BTC, ETH, SOL…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={dataSource === "yahoo" ? handleYahooKeyDown : undefined}
            className="bg-tv-bg"
          />
          {dataSource === "yahoo" && (
            <p className="mt-1.5 text-[10px] text-tv-text-muted">
              Ingresá cualquier ticker y presioná Enter, o seleccioná una posición de tu portfolio.
            </p>
          )}
        </div>
        <ScrollArea className="h-[400px]">
          <div className="flex flex-col">
            {dataSource === "yahoo" ? (
              <>
                {filteredYahoo.length === 0 && !query && (
                  <div className="p-4 text-center text-xs text-tv-text-muted">
                    No hay posiciones abiertas
                  </div>
                )}
                {filteredYahoo.length === 0 && query && (
                  <div className="p-4 text-center text-xs text-tv-text-muted">
                    Presioná Enter para buscar &ldquo;{query.toUpperCase()}&rdquo;
                  </div>
                )}
                {filteredYahoo.map((ticker) => (
                  <button
                    key={ticker}
                    type="button"
                    onClick={() => selectTicker(ticker)}
                    className={cn(
                      "flex items-center justify-between border-b border-tv-border px-4 py-2.5 text-left text-xs hover:bg-tv-panel-hover",
                      ticker === symbol && "bg-tv-panel-hover",
                    )}
                  >
                    <span className="font-semibold text-tv-text">{ticker}</span>
                    <span className="text-[10px] text-tv-text-muted">Portfolio</span>
                  </button>
                ))}
              </>
            ) : (
              <>
                {filteredBinance.length === 0 && (
                  <div className="p-4 text-center text-xs text-tv-text-muted">
                    Sin resultados
                  </div>
                )}
                {filteredBinance.map((s) => (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => selectTicker(s.symbol)}
                    className={cn(
                      "flex items-center justify-between border-b border-tv-border px-4 py-2 text-left text-xs hover:bg-tv-panel-hover",
                      s.symbol === symbol && "bg-tv-panel-hover",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-tv-text">{s.baseAsset}</span>
                      <span className="text-tv-text-muted">/ {s.quoteAsset}</span>
                    </div>
                    <span className="text-tv-text-muted">{s.symbol}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
