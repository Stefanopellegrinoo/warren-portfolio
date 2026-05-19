"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
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
  return isInWatchlist ? "★ In watchlist" : "Add to watchlist";
}

/**
 * Returns whether the button should be disabled.
 */
export function getAddButtonDisabled(isInWatchlist: boolean, isLoading: boolean): boolean {
  return isInWatchlist || isLoading;
}

// ── Component ──────────────────────────────────────────────────────────────────

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
  const [addedListIds, setAddedListIds] = useState<Set<string>>(new Set());

  // ── Direct add (watchlistId provided) ──────────────────────────────────────

  const inWatchlist = isInWatchlist || addedLocally;
  const disabled = getAddButtonDisabled(inWatchlist, loading);
  const label = getAddButtonLabel(inWatchlist);

  async function handleDirectClick() {
    if (!watchlistId || disabled) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAddPayload(symbol, watchlistId)),
      });
      if (res.ok || res.status === 409) {
        setAddedLocally(true);
        onAdded?.(watchlistId);
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }

  // ── Popover: lazy-fetch lists on first open ─────────────────────────────────

  async function handlePopoverOpenChange(open: boolean) {
    setPopoverOpen(open);
    if (open && popoverLists.length === 0 && !popoverLoading) {
      setPopoverLoading(true);
      try {
        const res = await fetch(getListsUrl());
        if (res.ok) {
          const data = await res.json();
          setPopoverLists(data.lists ?? []);
        }
      } catch {
        // silently ignore
      } finally {
        setPopoverLoading(false);
      }
    }
  }

  async function handleAddToList(listId: string) {
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAddPayload(symbol, listId)),
      });
      if (res.ok || res.status === 409) {
        setAddedListIds((prev) => new Set(prev).add(listId));
        setPopoverOpen(false);
        onAdded?.(listId);
      }
    } catch {
      // silently ignore
    }
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
          "rounded px-2 py-1 text-[10px] font-medium transition-colors",
          inWatchlist
            ? "cursor-default text-tv-green opacity-75"
            : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
          loading && "opacity-50"
        )}
        aria-label={
          inWatchlist
            ? `${symbol} is in your watchlist`
            : `Add ${symbol} to watchlist`
        }
      >
        {loading ? "..." : label}
      </button>
    );
  }

  // Popover mode: click → list picker
  return (
    <Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
      <PopoverTrigger
        className={cn(
          "rounded px-2 py-1 text-[10px] font-medium transition-colors",
          "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
        )}
        aria-label={`Add ${symbol} to a watchlist`}
      >
        + Watch
      </PopoverTrigger>
      <PopoverContent className="min-w-[10rem] p-1">
        {popoverLoading ? (
          <div className="px-3 py-2 text-[10px] text-tv-text-muted">Loading…</div>
        ) : popoverLists.length === 0 ? (
          <div className="px-3 py-2 text-[10px] text-tv-text-muted">No watchlists found.</div>
        ) : (
          popoverLists.map((list) => {
            const alreadyAdded = addedListIds.has(list.id);
            return (
              <button
                key={list.id}
                type="button"
                disabled={alreadyAdded}
                onClick={() => handleAddToList(list.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-[10px] transition-colors",
                  alreadyAdded
                    ? "cursor-default text-tv-green opacity-75"
                    : "text-tv-text hover:bg-tv-panel-hover"
                )}
              >
                <span>{list.name}</span>
                {alreadyAdded && <span className="ml-2">★ Added</span>}
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
