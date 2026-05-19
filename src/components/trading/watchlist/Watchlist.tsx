"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { fetchTickers24h } from "@/lib/binance/rest";
import { getBinanceWS } from "@/lib/binance/ws";
import { useChartStore } from "@/lib/store/chart-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatPrice, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { WatchlistSelector } from "./WatchlistSelector";

interface Row {
  symbol: string;
  price: number;
  pct: number;
}

interface WatchlistProps {
  onSelectSymbol?: (ticker: string) => void;
}

export function Watchlist({ onSelectSymbol }: WatchlistProps = {}) {
  const activeId = useChartStore((s) => s.activeWatchlistId);
  const localWatchlist = useChartStore((s) => s.watchlist);
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const removeFromLocal = useChartStore((s) => s.removeFromWatchlist);
  const openSymbolDialog = useChartStore((s) => s.setSymbolDialogOpen);
  
  const [currentList, setCurrentList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [flash, setFlash] = useState<Record<string, "up" | "down" | null>>({});

  // 1. Sync symbols when activeId or localWatchlist changes
  useEffect(() => {
    if (!activeId) {
      setCurrentList(localWatchlist);
      return;
    }

    let cancelled = false;
    async function fetchRemote() {
      setLoading(true);
      try {
        const res = await fetch(`/api/watchlist?watchlistId=${activeId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setCurrentList(data.items.map((i: any) => i.symbol));
        }
      } catch (e) {
        console.error("Failed to fetch remote watchlist", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRemote();
    return () => { cancelled = true; };
  }, [activeId, localWatchlist]);

  // 2. Data fetching & WS logic for currentList
  useEffect(() => {
    if (currentList.length === 0) {
      setRows({});
      return;
    }
    let cancelled = false;

    const binanceTickers = currentList.filter(s => getProviderForSymbol(s) === 'binance');
    const yahooTickers = currentList.filter(s => getProviderForSymbol(s) === 'yahoo');

    // BINANCE
    if (binanceTickers.length > 0) {
      fetchTickers24h(binanceTickers)
        .then((tickers) => {
          if (cancelled) return;
          setRows((prev) => {
            const next = { ...prev };
            tickers.forEach((t) => {
              next[t.symbol] = { symbol: t.symbol, price: t.lastPrice, pct: t.priceChangePercent };
            });
            return next;
          });
        });

      const ws = getBinanceWS();
      const unsub = ws.subscribeMiniTickers(binanceTickers, (tick) => {
        setRows((prev) => {
          const prevRow = prev[tick.symbol];
          if (prevRow) {
            if (tick.close > prevRow.price) {
              setFlash((f) => ({ ...f, [tick.symbol]: "up" }));
              setTimeout(() => setFlash((f) => ({ ...f, [tick.symbol]: null })), 300);
            } else if (tick.close < prevRow.price) {
              setFlash((f) => ({ ...f, [tick.symbol]: "down" }));
              setTimeout(() => setFlash((f) => ({ ...f, [tick.symbol]: null })), 300);
            }
          }
          return { ...prev, [tick.symbol]: { symbol: tick.symbol, price: tick.close, pct: tick.pct } };
        });
      });
      
      return () => { cancelled = true; unsub(); };
    }

    // YAHOO
    if (yahooTickers.length > 0) {
      const fetchYahoo = async () => {
        try {
          const res = await fetch(`/api/quote?tickers=${encodeURIComponent(yahooTickers.join(","))}`);
          if (res.ok && !cancelled) {
            const data = await res.json();
            setRows((prev) => {
              const next = { ...prev };
              data.forEach((q: any) => {
                next[q.ticker] = { symbol: q.ticker, price: q.price, pct: q.change_pct ?? 0 };
              });
              return next;
            });
          }
        } catch {}
      };
      fetchYahoo();
      const id = setInterval(fetchYahoo, 30000);
      return () => { cancelled = true; clearInterval(id); };
    }
  }, [currentList]);

  const handleRemove = async (s: string) => {
    if (!activeId) {
      removeFromLocal(s);
      return;
    }

    try {
      const res = await fetch(`/api/watchlist?symbol=${s}&watchlistId=${activeId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setCurrentList(prev => prev.filter(item => item !== s));
      }
    } catch (e) {
      console.error("Failed to remove item", e);
    }
  };

  return (
    <div className="flex h-full flex-col bg-tv-bg">
      <WatchlistSelector />
      
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-tv-text-dim">
          {loading ? "Sincronizando..." : "Símbolos"}
        </h2>
        <button
          onClick={() => openSymbolDialog(true)}
          className="rounded p-1 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-tv-text-dim/60 border-b border-tv-border/40">
        <span>Tícker</span>
        <span className="text-right">Precio</span>
        <span className="text-right">Cambio</span>
      </div>

      <ScrollArea className="flex-1">
        {loading && currentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="h-5 w-5 text-tv-blue animate-spin" />
            <span className="text-[10px] text-tv-text-dim uppercase tracking-widest">Cargando lista...</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {currentList.map((s) => {
              const row = rows[s];
              const isActive = s === symbol;
              const f = flash[s];
              const provider = getProviderForSymbol(s);
              
              return (
                <div
                  key={s}
                  onClick={() => { setSymbol(s); onSelectSymbol?.(s); }}
                  className={cn(
                    "group grid cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2 text-xs transition-all duration-200",
                    "hover:bg-tv-panel-hover border-l-2 border-transparent",
                    isActive && "bg-tv-blue/5 border-tv-blue",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "font-semibold tracking-tight transition-colors",
                      isActive ? "text-tv-blue" : "text-tv-text"
                    )}>
                      {provider === 'binance' ? s.replace("USDT", "") : s}
                    </span>
                    {provider === 'binance' && (
                      <span className="text-[9px] text-tv-text-dim font-bold opacity-50">USDT</span>
                    )}
                    {provider === 'yahoo' && (
                      <span className="text-[8px] text-amber-500 font-bold px-1 rounded border border-amber-500/20 bg-amber-500/5">STK</span>
                    )}
                  </div>
                  
                  <span className={cn(
                    "text-right tabular-nums font-medium transition-colors duration-300",
                    f === "up" && "text-tv-green",
                    f === "down" && "text-tv-red",
                    !f && (isActive ? "text-tv-text" : "text-tv-text/90"),
                  )}>
                    {row ? formatPrice(row.price) : "—"}
                  </span>

                  <div className="flex items-center justify-end gap-1.5 w-[64px]">
                    <span className={cn(
                      "tabular-nums text-[11px] font-bold px-1.5 py-0.5 rounded-sm min-w-[50px] text-right",
                      row
                        ? row.pct >= 0
                          ? "text-tv-green bg-tv-green/10"
                          : "text-tv-red bg-tv-red/10"
                        : "text-tv-text-muted",
                    )}>
                      {row ? (row.pct >= 0 ? "+" : "") + formatPct(row.pct) : "—"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(s);
                      }}
                      className="invisible opacity-0 group-hover:opacity-100 group-hover:visible transition-all rounded p-0.5 text-tv-text-dim hover:bg-tv-red/20 hover:text-tv-red"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            
            {currentList.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="w-12 h-12 rounded-full bg-tv-panel flex items-center justify-center mb-4">
                  <Plus className="h-6 w-6 text-tv-text-dim" />
                </div>
                <p className="text-[11px] text-tv-text-dim uppercase tracking-wider font-bold mb-1">
                  Lista vacía
                </p>
                <p className="text-[10px] text-tv-text-muted leading-relaxed">
                  Agregá símbolos usando el botón + arriba a la derecha.
                </p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
