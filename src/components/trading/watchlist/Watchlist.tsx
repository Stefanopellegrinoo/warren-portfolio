"use client";

import { useEffect, useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchTickers24h } from "@/lib/binance/rest";
import { getBinanceWS } from "@/lib/binance/ws";
import { CARTERA_LIST_ID, PORTFOLIO_SYMBOL, useChartStore } from "@/lib/store/chart-store";
import { getPortfolio } from "@/lib/warren/positions";
import { portfolioDayChangePct } from "@/lib/chart/compare";
import type { Position } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatPct } from "@/lib/utils";
import { Chip, toneOf } from "@/components/resumen/ui";
import { iconButton, priceText } from "@/components/trading/ui";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import { addSymbolToCurrentWatchlist } from "@/lib/warren/watchlist";
import { requestErrorMessage } from "@/lib/request-errors";
import { LoadError } from "@/components/ons/ui";
import { WatchlistSelector } from "./WatchlistSelector";
import { useWatchlistExtras } from "./useWatchlistExtras";

interface Row {
  symbol: string;
  price: number;
  pct: number;
}

interface WatchlistProps {
  onSelectSymbol?: (ticker: string) => void;
  /** The list's width on screen (0 while hidden): wider shows each asset's name, then its last month. */
  width?: number;
}

export function Watchlist({ onSelectSymbol, width = 0 }: WatchlistProps = {}) {
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
  // Cartera: the stocks held right now, read from the portfolio, never from a stored list.
  const cartera = activeId === CARTERA_LIST_ID;
  const [positions, setPositions] = useState<Position[]>([]);
  const extras = useWatchlistExtras(currentList, width);
  // Fixed columns once the line is there, so every row's line and price sit under their headers.
  const cols = extras.showLine ? "grid-cols-[minmax(0,1fr)_76px_96px_76px]" : "grid-cols-[minmax(0,1fr)_auto_76px]";

  // Effect A — local watchlist mirror (only when no activeId)
  useEffect(() => {
    if (activeId) return;
    setCurrentList(localWatchlist);
  }, [activeId, localWatchlist]);

  // Effect B — remote watchlist fetch (only when activeId is set)
  useEffect(() => {
    if (!activeId || activeId === CARTERA_LIST_ID) return;
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

  // Effect C — Cartera: the positions held (stocks and CEDEARs)
  useEffect(() => {
    if (activeId !== CARTERA_LIST_ID) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getPortfolio()
      .then((data) => {
        if (cancelled) return;
        setPositions(data.positions ?? []);
        setCurrentList((data.positions ?? []).map((p) => p.ticker));
      })
      .catch((e) => { if (!cancelled) setLoadError(requestErrorMessage(e, "No se pudo cargar tu cartera.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeId, attempt]);

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
    if (activeId === CARTERA_LIST_ID) return; // the stocks held: nothing to remove
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
        {!cartera && (
          <button
            type="button"
            aria-label="Agregar símbolo"
            title="Agregar símbolo"
            // The pick goes to the list and opens on the chart.
            onClick={() => openSymbolDialog(true, (s) => { setSymbol(s); void addSymbolToCurrentWatchlist(s); })}
            className={iconButton}
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </div>

      <div aria-hidden="true" className={cn("grid gap-2 border-b border-line py-1.5 pl-4 pr-10 text-xs text-ink-3", cols)}>
        <span>Símbolo</span>
        {extras.showLine && <span className="text-center">1 mes</span>}
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
            {cartera && currentList.length > 0 && (
              <PortfolioRow active={symbol === PORTFOLIO_SYMBOL} pct={portfolioDayChangePct(positions)} onSelect={() => { setSymbol(PORTFOLIO_SYMBOL); onSelectSymbol?.(PORTFOLIO_SYMBOL); }} />
            )}
            {currentList.map((s) => {
              const row = rows[s];
              const isActive = s === symbol;
              const f = flash[s];
              const isCrypto = getProviderForSymbol(s) === "binance";
              const name = extras.name(s);
              const line = extras.line(s);

              return (
                <li key={s} className={cn("group relative flex items-center border-b border-line hover:bg-hover", isActive && "bg-hover")}>
                  {isActive && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded bg-accent" />}
                  <button
                    type="button"
                    aria-current={isActive || undefined}
                    onClick={() => { setSymbol(s); onSelectSymbol?.(s); }}
                    className={cn("grid min-h-10 min-w-0 flex-1 items-center gap-2 py-1.5 pl-4 text-left text-[13px] tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-[819px]:min-h-11", cols)}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className={cn("truncate text-ink", isActive && "font-semibold")}>
                        {isCrypto ? s.replace("USDT", "") : s}
                        {isCrypto && <span className="ml-1 text-xs text-ink-3">USDT</span>}
                      </span>
                      {name && <span className="truncate text-xs text-ink-3">{name}</span>}
                    </span>
                    {extras.showLine && <span className="flex justify-center">{line && <MonthLine closes={line} />}</span>}
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
                  {/* Cartera has nothing to remove, but keeps the column so prices sit under their headers. */}
                  {cartera && <span data-remove-slot aria-hidden="true" className="mx-1 h-8 w-8 flex-none max-[819px]:h-11 max-[819px]:w-11" />}
                  {!cartera && <button
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
                  </button>}
                </li>
              );
            })}
          </ul>
        )}
        {currentList.length === 0 && !loading && !loadError && (
          cartera ? (
            <div className="px-4 py-6 text-[13px]">
              <p className="text-ink-2">No tenés acciones en cartera.</p>
              <p className="mt-1 text-ink-3">Cuando compres una, aparece acá sola.</p>
            </div>
          ) : (
            <div className="px-4 py-6 text-[13px]">
              <p className="text-ink-2">La lista está vacía.</p>
              <p className="mt-1 text-ink-3">Agregá símbolos con el botón + de arriba.</p>
            </div>
          )
        )}
      </ScrollArea>
    </div>
  );
}

/** The last month's daily closes as a line, green when it ended up and red when down. */
function MonthLine({ closes }: { closes: number[] }) {
  const w = 72, h = 24;
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const points = closes.map((v, i) => `${((i / (closes.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" className={closes[closes.length - 1] >= closes[0] ? "text-ok" : "text-danger"}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Mi cartera at the top of Cartera: the stock portfolio as one more asset, with today's change. */
function PortfolioRow({ active, pct, onSelect }: { active: boolean; pct: number | null; onSelect: () => void }) {
  return (
    <li className={cn("relative flex items-center border-b border-line hover:bg-hover", active && "bg-hover")}>
      {active && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded bg-accent" />}
      <button
        type="button"
        aria-current={active || undefined}
        onClick={onSelect}
        className="grid min-h-10 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_76px] items-center gap-2 py-1.5 pl-4 pr-10 text-left text-[13px] tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-[819px]:min-h-11"
      >
        <span className="flex min-w-0 flex-col">
          <span className={cn("truncate text-ink", active && "font-semibold")}>Mi cartera</span>
          <span className="truncate text-xs text-ink-3">Rendimiento de las acciones</span>
        </span>
        <span className="flex justify-end">
          {pct !== null ? <Chip tone={toneOf(pct)}>{formatPct(pct / 100)}</Chip> : <span className="text-ink-3">—</span>}
        </span>
      </button>
    </li>
  );
}
