"use client";

import { useEffect, useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchTickers24h } from "@/lib/binance/rest";
import { getBinanceWS } from "@/lib/binance/ws";
import { useChartStore } from "@/lib/store/chart-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatPct } from "@/lib/utils";
import { Chip, toneOf } from "@/components/resumen/ui";
import { iconButton, priceText } from "@/components/trading/ui";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { addSymbolToCurrentWatchlist } from "@/lib/warren/watchlist";
import { requestErrorMessage } from "@/lib/request-errors";
import { LoadError } from "@/components/ons/ui";
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
  const watchlistRefreshTick = useChartStore((s) => s.watchlistRefreshTick);
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const removeFromLocal = useChartStore((s) => s.removeFromWatchlist);
  const openSymbolDialog = useChartStore((s) => s.setSymbolDialogOpen);

  const [currentList, setCurrentList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [flash, setFlash] = useState<Record<string, "up" | "down" | null>>({});

  // Effect A — local watchlist mirror (only when no activeId)
  useEffect(() => {
    if (activeId) return;
    setCurrentList(localWatchlist);
  }, [activeId, localWatchlist]);

  // Effect B — remote watchlist fetch (only when activeId is set)
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/watchlist?watchlistId=${activeId}`)
      .then(async (res) => {
        if (res.ok) return res.json();
        throw new Error((await res.json().catch(() => null))?.error ?? "");
      })
      .then((data) => {
        if (cancelled) return;
        setCurrentList(data.items.map((i: { symbol: string }) => i.symbol));
      })
      .catch((e) => { if (!cancelled) setLoadError(requestErrorMessage(e, "No se pudo cargar la lista.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeId, watchlistRefreshTick, attempt]);

  // Effect: data fetching — Binance WS + Yahoo polling, both run in parallel
  useEffect(() => {
    if (currentList.length === 0) {
      setRows({});
      return;
    }

    let cancelled = false;
    const teardowns: Array<() => void> = [];

    const binanceTickers = currentList.filter(s => getProviderForSymbol(s) === 'binance');
    const yahooTickers = currentList.filter(s => getProviderForSymbol(s) === 'yahoo');

    // --- Binance branch (REST seed + WS live) ---
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
        })
        .catch((e) => console.error('Watchlist binance seed failed', e));

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
      teardowns.push(unsub);
    }

    // --- Yahoo branch (poll /api/quote every 30s) ---
    if (yahooTickers.length > 0) {
      const fetchYahoo = async () => {
        try {
          const res = await fetch(`/api/quote?tickers=${encodeURIComponent(yahooTickers.join(","))}`);
          if (!res.ok || cancelled) return;
          const data = await res.json();
          setRows((prev) => {
            const next = { ...prev };
            data.forEach((q: { ticker: string; price: number | null; change_pct: number }) => {
              if (q.price === null) return // unavailable: keep the last row
              next[q.ticker] = { symbol: q.ticker, price: q.price, pct: q.change_pct ?? 0 };
            });
            return next;
          });
        } catch (e) {
          console.error('Watchlist yahoo poll failed', e);
        }
      };
      fetchYahoo();
      const id = setInterval(fetchYahoo, 30_000);
      teardowns.push(() => clearInterval(id));
    }

    return () => {
      cancelled = true;
      teardowns.forEach((fn) => fn());
    };
  }, [currentList]);

  const handleRemove = async (s: string) => {
    const removed = () => toast.success("Quitado de la lista", { description: s });
    if (!activeId) {
      removeFromLocal(s);
      removed();
      return;
    }

    const fallback = `No se pudo quitar ${s} de la lista`;
    setRemoving(s);
    try {
      const res = await fetch(`/api/watchlist?symbol=${s}&watchlistId=${activeId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setCurrentList(prev => prev.filter(item => item !== s));
        removed();
      } else {
        toast.error((await res.json().catch(() => null))?.error ?? fallback);
      }
    } catch (e) {
      toast.error(requestErrorMessage(e, fallback));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <WatchlistSelector />
        <button
          type="button"
          aria-label="Agregar símbolo"
          title="Agregar símbolo"
          onClick={() => openSymbolDialog(true, addSymbolToCurrentWatchlist)}
          className={iconButton}
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_auto_76px] gap-2 border-b border-line py-1.5 pl-4 pr-10 text-xs text-ink-3">
        <span>Símbolo</span>
        <span className="text-right">Precio</span>
        <span className="text-right">Var. día</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {loadError && (
          <div className="p-2">
            <LoadError message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
          </div>
        )}
        {loading && currentList.length === 0 ? (
          <p role="status" className="flex items-center gap-2 px-4 py-6 text-[13px] text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Cargando lista…
          </p>
        ) : (
          <ul aria-label="Símbolos de la lista">
            {currentList.map((s) => {
              const row = rows[s];
              const isActive = s === symbol;
              const f = flash[s];
              const isCrypto = getProviderForSymbol(s) === "binance";

              return (
                <li key={s} className={cn("group relative flex items-center border-b border-line hover:bg-hover", isActive && "bg-hover")}>
                  {isActive && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded bg-accent" />}
                  <button
                    type="button"
                    aria-current={isActive || undefined}
                    onClick={() => { setSymbol(s); onSelectSymbol?.(s); }}
                    className="grid min-h-10 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_76px] items-center gap-2 py-1.5 pl-4 text-left text-[13px] tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-[819px]:min-h-11"
                  >
                    <span className={cn("truncate text-ink", isActive && "font-semibold")}>
                      {isCrypto ? s.replace("USDT", "") : s}
                      {isCrypto && <span className="ml-1 text-xs text-ink-3">USDT</span>}
                    </span>
                    <span className={cn(
                      "text-right transition-colors duration-300 motion-reduce:transition-none",
                      f === "up" ? "text-ok" : f === "down" ? "text-danger" : "text-ink",
                    )}>
                      {row ? priceText(row.price) : "—"}
                    </span>
                    <span className="flex justify-end">
                      {row ? <Chip tone={toneOf(row.pct)}>{formatPct(row.pct / 100)}</Chip> : <span className="text-ink-3">—</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Quitar ${s} de la lista`}
                    title="Quitar de la lista"
                    disabled={removing === s}
                    onClick={() => handleRemove(s)}
                    className="mx-1 grid h-8 w-8 flex-none place-items-center rounded-md text-ink-3 opacity-0 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 max-[819px]:h-11 max-[819px]:w-11 max-[819px]:opacity-100"
                  >
                    {removing === s
                      ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      : <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {currentList.length === 0 && !loading && !loadError && (
          <div className="px-4 py-6 text-[13px]">
            <p className="text-ink-2">La lista está vacía.</p>
            <p className="mt-1 text-ink-3">Agregá símbolos con el botón + de arriba.</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
