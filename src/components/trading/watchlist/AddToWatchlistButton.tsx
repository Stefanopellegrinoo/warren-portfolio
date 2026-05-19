"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// ── Pure utility exports (exported for unit testing) ──────────────────────────

/**
 * Build the POST body payload for adding a symbol to the watchlist.
 */
export function buildAddToWatchlistPayload(symbol: string): { symbol: string } {
  return { symbol };
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
  isInWatchlist: boolean;
  onAdded?: () => void;
}

export function AddToWatchlistButton({ symbol, isInWatchlist, onAdded }: AddToWatchlistButtonProps) {
  const [loading, setLoading] = useState(false);
  const [addedLocally, setAddedLocally] = useState(false);

  const inWatchlist = isInWatchlist || addedLocally;
  const disabled = getAddButtonDisabled(inWatchlist, loading);
  const label = getAddButtonLabel(inWatchlist);

  async function handleClick() {
    if (disabled) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAddToWatchlistPayload(symbol)),
      });
      if (res.ok || res.status === 409) {
        // 201 = added, 409 = already exists; either way, show as in watchlist
        setAddedLocally(true);
        onAdded?.();
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        "rounded px-2 py-1 text-[10px] font-medium transition-colors",
        inWatchlist
          ? "cursor-default text-tv-green opacity-75"
          : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
        loading && "opacity-50"
      )}
      aria-label={inWatchlist ? `${symbol} is in your watchlist` : `Add ${symbol} to watchlist`}
    >
      {loading ? "..." : label}
    </button>
  );
}
