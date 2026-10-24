"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { requestErrorMessage } from "@/lib/request-errors";
import { LoadError } from "@/components/ons/ui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { WatchlistItem } from "@/app/api/watchlist/route";
import type { Watchlist } from "@/app/api/watchlist/lists/route";

// ── Pure utility exports (exported for unit testing) ──────────────────────────

/**
 * Build the POST body payload for adding a symbol to a specific watchlist.
 */
export function buildAddPayload(
  symbol: string,
  watchlistId: string
): { symbol: string; watchlistId: string } {
  return { symbol, watchlistId };
}

/**
 * Returns true when the given symbol exists in the provided items array.
 */
export function isSymbolInList(items: WatchlistItem[], symbol: string): boolean {
  return items.some((item) => item.symbol === symbol);
}

/**
 * Returns the URL for the watchlist lists API.
 */
export function getListsUrl(): string {
  return "/api/watchlist/lists";
}

/**
 * Returns the button label based on whether the symbol is in the watchlist.
 */
export function getAddButtonLabel(isInWatchlist: boolean): string {
  return isInWatchlist ? "En la lista" : "Agregar a la lista";
}

/**
 * Returns whether the button should be disabled.
 */
export function getAddButtonDisabled(isInWatchlist: boolean, isLoading: boolean): boolean {
  return isInWatchlist || isLoading;
}

// ── Component ──────────────────────────────────────────────────────────────────

const ADD_FAILED = "No se pudo agregar a la lista";

/** Adds the symbol to a list: the response status when it is there now (409: it already was), or null after saying why it failed. */
async function addToList(symbol: string, listId: string): Promise<number | null> {
  try {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAddPayload(symbol, listId)),
    });
    if (res.ok || res.status === 409) return res.status;
    toast.error((await res.json().catch(() => null))?.error ?? ADD_FAILED);
  } catch (e) {
    toast.error(requestErrorMessage(e, ADD_FAILED));
  }
  return null;
}

interface AddToWatchlistButtonProps {
  symbol: string;
  /**
   * When provided, clicking adds the symbol directly to this list.
   * When absent, clicking opens a popover to select a list.
   */
  watchlistId?: string;
  /**
   * Pre-computed membership flag for the provided watchlistId.
   * Only meaningful when watchlistId is set.
   */
  isInWatchlist?: boolean;
  onAdded?: (listId: string) => void;
}

export function AddToWatchlistButton({
  symbol,
  watchlistId,
  isInWatchlist = false,
  onAdded,
}: AddToWatchlistButtonProps) {
  const [loading, setLoading] = useState(false);
  const [addedLocally, setAddedLocally] = useState(false);

  // Popover state — only used when watchlistId is absent
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverLists, setPopoverLists] = useState<Watchlist[]>([]);
  const [popoverLoading, setPopoverLoading] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedListIds, setAddedListIds] = useState<Set<string>>(new Set());

  // ── Direct add (watchlistId provided) ──────────────────────────────────────

  const inWatchlist = isInWatchlist || addedLocally;
  const disabled = getAddButtonDisabled(inWatchlist, loading);
  const label = getAddButtonLabel(inWatchlist);

  async function handleDirectClick() {
    if (!watchlistId || disabled) return;
    setLoading(true);
    // The button itself turns into "En la lista": no toast needed.
    if (await addToList(symbol, watchlistId)) {
      setAddedLocally(true);
      onAdded?.(watchlistId);
    }
    setLoading(false);
  }

  // ── Popover: lazy-fetch lists on first open ─────────────────────────────────

  async function loadLists() {
    setPopoverLoading(true);
    setListsError(null);
    try {
      const res = await fetch(getListsUrl());
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "");
      const data = await res.json();
      setPopoverLists(data.lists ?? []);
    } catch (e) {
      setListsError(requestErrorMessage(e, "No se pudieron cargar tus listas."));
    } finally {
      setPopoverLoading(false);
    }
  }

  function handlePopoverOpenChange(open: boolean) {
    setPopoverOpen(open);
    if (open && popoverLists.length === 0 && !popoverLoading) loadLists();
  }

  async function handleAddToList(list: Watchlist) {
    setAddingId(list.id);
    const status = await addToList(symbol, list.id);
    setAddingId(null);
    if (!status) return;
    setAddedListIds((prev) => new Set(prev).add(list.id));
    setPopoverOpen(false);
    onAdded?.(list.id);
    toast.success(status === 409 ? "Ya estaba en la lista" : "Agregado a la lista", { description: list.name });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (watchlistId) {
    // Direct mode: one-click add
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={handleDirectClick}
        className={cn(
          "inline-flex min-h-8 items-center rounded-md px-2 text-xs font-medium max-[819px]:min-h-11",
          inWatchlist ? "cursor-default text-ink-3" : "text-accent-ink hover:bg-accent-soft",
          loading && "opacity-60"
        )}
        aria-label={inWatchlist ? `${symbol} está en la lista` : `Agregar ${symbol} a la lista`}
        aria-busy={loading}
      >
        {label}
      </button>
    );
  }

  // Popover mode: click → list picker
  return (
    <Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
      <PopoverTrigger
        className="inline-flex min-h-8 items-center rounded-md px-2 text-xs font-medium text-accent-ink hover:bg-accent-soft max-[819px]:min-h-11"
        aria-label={`Agregar ${symbol} a una lista`}
      >
        + Lista
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[10rem] max-w-[calc(100vw-32px)] rounded-lg border border-line bg-surface p-1 text-ink shadow-pop ring-0">
        {popoverLoading ? (
          <p role="status" className="px-3 py-2 text-[13px] text-ink-3">Cargando…</p>
        ) : listsError ? (
          <LoadError message={listsError} onRetry={loadLists} />
        ) : popoverLists.length === 0 ? (
          <p className="px-3 py-2 text-[13px] text-ink-3">No tenés listas guardadas.</p>
        ) : (
          popoverLists.map((list) => {
            const alreadyAdded = addedListIds.has(list.id);
            return (
              <button
                key={list.id}
                type="button"
                disabled={alreadyAdded || addingId === list.id}
                onClick={() => handleAddToList(list)}
                className={cn(
                  "flex min-h-9 w-full items-center justify-between gap-3 rounded px-3 text-left text-[13px] max-[819px]:min-h-11",
                  alreadyAdded ? "cursor-default text-ink-3" : "text-ink hover:bg-hover"
                )}
              >
                <span>{list.name}</span>
                {alreadyAdded && <span className="text-xs">Agregado</span>}
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
