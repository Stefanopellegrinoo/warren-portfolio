"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { X, Plus, Pencil, Trash2, Check, XCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { debounce, fetchTickerSearch } from "@/components/trading/chart/SymbolSelector";
import { AddToWatchlistButton } from "@/components/trading/watchlist/AddToWatchlistButton";
import type { WatchlistItem } from "@/app/api/watchlist/route";
import type { Watchlist } from "@/app/api/watchlist/lists/route";
import type { SearchResult } from "@/lib/market-data/types";

// ── Pure utility exports (exported for unit testing) ──────────────────────────

/**
 * Format a price value for display.
 * Returns "—" for null or zero values.
 */
export function formatWatchlistPrice(price: number | null): string {
  if (price === null || price === 0) return "—";
  return `$${price.toFixed(2)}`;
}

/**
 * Format a percent change value with sign prefix.
 * Returns "—" for null values.
 */
export function formatWatchlistChange(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Returns the Tailwind color class for a change percent value.
 * Positive → green, negative → red, null → muted.
 */
export function getChangeColorClass(pct: number | null): string {
  if (pct === null) return "text-tv-text-muted";
  return pct >= 0 ? "text-tv-green" : "text-tv-red";
}

/**
 * Select the list with the given id, or fall back to the first list.
 * Returns undefined if the lists array is empty.
 */
export function selectList(lists: Watchlist[], id: string | null): Watchlist | undefined {
  if (lists.length === 0) return undefined;
  if (id === null) return lists[0];
  return lists.find((l) => l.id === id) ?? lists[0];
}

/**
 * Returns the URL for the watchlist lists API.
 */
export function buildListsUrl(): string {
  return "/api/watchlist/lists";
}

/**
 * Builds the URL for fetching items of a specific watchlist.
 */
export function buildItemsUrl(watchlistId: string): string {
  return `/api/watchlist?watchlistId=${encodeURIComponent(watchlistId)}`;
}

/**
 * Build the POST body payload for creating a new watchlist.
 */
export function buildCreateListPayload(name: string): { name: string } {
  return { name };
}

/**
 * Build the PATCH body payload for renaming a watchlist.
 */
export function buildRenamePayload(name: string): { name: string } {
  return { name };
}

/**
 * Returns true when the user has only one (or zero) lists — delete must be disabled.
 */
export function isLastList(lists: Watchlist[]): boolean {
  return lists.length <= 1;
}

/**
 * Build the DELETE URL for removing a symbol from a watchlist.
 */
export function buildDeleteItemUrl(symbol: string, watchlistId: string): string {
  return `/api/watchlist?symbol=${encodeURIComponent(symbol)}&watchlistId=${encodeURIComponent(watchlistId)}`;
}

/**
 * Returns true when the search query is long enough to trigger a fetch.
 * Minimum 2 characters required.
 */
export function shouldSearch(q: string): boolean {
  return q.length >= 2;
}

/**
 * Build the POST body payload for adding a symbol found via search.
 */
export function buildAddFromSearchPayload(
  symbol: string,
  watchlistId: string
): { symbol: string; watchlistId: string } {
  return { symbol, watchlistId };
}

// ── Component ──────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 60_000;
const MAX_LISTS = 10;

export function WatchlistPanel() {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Create-list inline form
  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingRequest, setIsCreatingRequest] = useState(false);

  // Rename inline form
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isRenamingRequest, setIsRenamingRequest] = useState(false);

  // Delete confirmation
  const [deletingListId, setDeletingListId] = useState<string | null>(null);
  const [isDeletingRequest, setIsDeletingRequest] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Race-guard counter: incremented on each fetchItems call; response is discarded if stale
  const reqId = useRef(0);

  // ── Fetch items for the active list ──────────────────────────────────────────

  const fetchItems = useCallback(async (listId: string) => {
    const current = ++reqId.current;
    setItemsLoading(true);
    try {
      const res = await fetch(buildItemsUrl(listId));
      if (current !== reqId.current) return; // stale — discard
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      // silently ignore network errors
    } finally {
      if (current === reqId.current) {
        setItemsLoading(false);
      }
    }
  }, []);

  // ── Fetch lists on mount ──────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function fetchLists() {
      try {
        const res = await fetch(buildListsUrl());
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json();
        const fetched: Watchlist[] = data.lists ?? [];
        setLists(fetched);
        if (fetched.length > 0) {
          setActiveListId(fetched[0].id);
        }
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) {
          setListsLoading(false);
        }
      }
    }

    fetchLists();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch items whenever active list changes ──────────────────────────────────

  useEffect(() => {
    if (!activeListId) return;
    fetchItems(activeListId);
  }, [activeListId, fetchItems]);

  // ── Auto-refresh items every 60s ──────────────────────────────────────────────

  useEffect(() => {
    if (!activeListId) return;
    const interval = setInterval(() => {
      fetchItems(activeListId);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeListId, fetchItems]);

  // ── Debounced ticker search ────────────────────────────────────────────────────

  const debouncedSearch = useRef(
    debounce(async (q: string) => {
      setIsSearching(true);
      const results = await fetchTickerSearch(q);
      setSearchResults(results);
      setIsSearching(false);
      setSearchOpen(results.length > 0);
    }, 300)
  ).current;

  useEffect(() => {
    if (!shouldSearch(searchQuery)) {
      setSearchResults([]);
      setSearchOpen(false);
      setIsSearching(false);
      return;
    }
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  // ── Delete item ───────────────────────────────────────────────────────────────

  async function handleDeleteItem(symbol: string) {
    if (!activeListId) return;
    // Optimistic remove
    setItems((prev) => prev.filter((item) => item.symbol !== symbol));
    try {
      const res = await fetch(buildDeleteItemUrl(symbol, activeListId), { method: "DELETE" });
      if (!res.ok) {
        // On failure, refetch to restore
        fetchItems(activeListId);
      }
    } catch {
      fetchItems(activeListId);
    }
  }

  // ── Create list ───────────────────────────────────────────────────────────────

  async function handleCreateList() {
    const name = newListName.trim();
    if (!name) {
      setCreateError("Name cannot be empty.");
      return;
    }
    if (name.length > 50) {
      setCreateError("Name must be 50 characters or fewer.");
      return;
    }
    setCreateError(null);
    setIsCreatingRequest(true);
    try {
      const res = await fetch(buildListsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCreateListPayload(name)),
      });
      if (res.ok || res.status === 201) {
        const data = await res.json();
        const created: Watchlist = data.list ?? data;
        setLists((prev) => [...prev, created]);
        setActiveListId(created.id);
        setItems([]);
        setIsCreating(false);
        setNewListName("");
      } else {
        const data = await res.json().catch(() => ({}));
        setCreateError(data.error ?? "Failed to create list.");
      }
    } catch {
      setCreateError("Network error. Please try again.");
    } finally {
      setIsCreatingRequest(false);
    }
  }

  // ── Rename list ───────────────────────────────────────────────────────────────

  async function handleRenameList(listId: string) {
    const name = editingName.trim();
    if (!name || name.length > 50) return;
    setIsRenamingRequest(true);
    try {
      const res = await fetch(`${buildListsUrl()}/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRenamePayload(name)),
      });
      if (res.ok) {
        setLists((prev) =>
          prev.map((l) => (l.id === listId ? { ...l, name } : l))
        );
        setEditingListId(null);
        setEditingName("");
      }
    } catch {
      // silently ignore
    } finally {
      setIsRenamingRequest(false);
    }
  }

  // ── Delete list ───────────────────────────────────────────────────────────────

  async function handleDeleteList(listId: string) {
    if (isLastList(lists)) return;
    setIsDeletingRequest(true);
    try {
      const res = await fetch(`${buildListsUrl()}/${listId}`, { method: "DELETE" });
      if (res.ok) {
        const remaining = lists.filter((l) => l.id !== listId);
        setLists(remaining);
        setDeletingListId(null);
        // Fall back to first remaining list
        if (remaining.length > 0) {
          setActiveListId(remaining[0].id);
        } else {
          setActiveListId(null);
          setItems([]);
        }
      }
    } catch {
      // silently ignore
    } finally {
      setIsDeletingRequest(false);
    }
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────────

  if (listsLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-tv-border px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Watchlist
          </h2>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-7 animate-pulse rounded bg-tv-panel-hover"
            />
          ))}
        </div>
      </div>
    );
  }

  const activeList = selectList(lists, activeListId);
  const canCreate = lists.length < MAX_LISTS;

  return (
    <div className="flex h-full flex-col">
      {/* ── List selector bar ──────────────────────────────────────────────── */}
      <div className="border-b border-tv-border">
        {/* Header row */}
        <div className="flex items-center justify-between px-3 py-1.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Watchlists
          </h2>
          <div className="flex items-center gap-1">
            {/* Rename button */}
            {activeList && editingListId !== activeList.id && (
              <button
                onClick={() => {
                  setEditingListId(activeList.id);
                  setEditingName(activeList.name);
                }}
                className="rounded p-1 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
                title="Rename list"
                aria-label="Rename list"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {/* Delete button — disabled when last list */}
            {activeList && (
              <button
                onClick={() => setDeletingListId(activeList.id)}
                disabled={isLastList(lists)}
                className={cn(
                  "rounded p-1 transition-colors",
                  isLastList(lists)
                    ? "cursor-not-allowed text-tv-text-dim opacity-40"
                    : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-red"
                )}
                title={isLastList(lists) ? "Cannot delete the last list" : "Delete list"}
                aria-label="Delete list"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            {/* Create list button */}
            <button
              onClick={() => { setIsCreating(true); setCreateError(null); }}
              disabled={!canCreate || isCreating}
              className={cn(
                "rounded p-1 transition-colors",
                canCreate && !isCreating
                  ? "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
                  : "cursor-not-allowed opacity-40 text-tv-text-dim"
              )}
              title={canCreate ? "Create new list" : "Maximum 10 lists reached"}
              aria-label="Create new watchlist"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* List tabs */}
        {lists.length > 0 && (
          <div className="flex gap-1 overflow-x-auto px-2 pb-1.5">
            {lists.map((list) => (
              <button
                key={list.id}
                onClick={() => {
                  if (editingListId === list.id) return;
                  setActiveListId(list.id);
                }}
                className={cn(
                  "shrink-0 rounded px-2 py-0.5 text-[10px] font-medium transition-colors whitespace-nowrap",
                  activeListId === list.id
                    ? "bg-tv-green/20 text-tv-green"
                    : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
                )}
              >
                {list.name}
              </button>
            ))}
          </div>
        )}

        {/* Inline rename form */}
        {editingListId && (
          <div className="flex items-center gap-1 px-2 pb-1.5">
            <input
              autoFocus
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameList(editingListId);
                if (e.key === "Escape") {
                  setEditingListId(null);
                  setEditingName("");
                }
              }}
              placeholder="List name"
              maxLength={50}
              disabled={isRenamingRequest}
              className="min-w-0 flex-1 rounded border border-tv-border bg-tv-bg px-2 py-0.5 text-[10px] text-tv-text outline-none focus:border-tv-green"
            />
            <button
              onClick={() => handleRenameList(editingListId)}
              disabled={isRenamingRequest || !editingName.trim()}
              className="rounded p-0.5 text-tv-green hover:bg-tv-panel-hover disabled:opacity-40"
              aria-label="Confirm rename"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={() => { setEditingListId(null); setEditingName(""); }}
              className="rounded p-0.5 text-tv-text-muted hover:bg-tv-panel-hover"
              aria-label="Cancel rename"
            >
              <XCircle className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Inline create form */}
        {isCreating && (
          <div className="flex flex-col gap-1 px-2 pb-1.5">
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newListName}
                onChange={(e) => { setNewListName(e.target.value); setCreateError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateList();
                  if (e.key === "Escape") {
                    setIsCreating(false);
                    setNewListName("");
                    setCreateError(null);
                  }
                }}
                placeholder="New list name"
                maxLength={50}
                disabled={isCreatingRequest}
                className="min-w-0 flex-1 rounded border border-tv-border bg-tv-bg px-2 py-0.5 text-[10px] text-tv-text outline-none focus:border-tv-green"
              />
              <button
                onClick={handleCreateList}
                disabled={isCreatingRequest || !newListName.trim()}
                className="rounded p-0.5 text-tv-green hover:bg-tv-panel-hover disabled:opacity-40"
                aria-label="Confirm create list"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                onClick={() => { setIsCreating(false); setNewListName(""); setCreateError(null); }}
                className="rounded p-0.5 text-tv-text-muted hover:bg-tv-panel-hover"
                aria-label="Cancel create list"
              >
                <XCircle className="h-3 w-3" />
              </button>
            </div>
            {createError && (
              <p className="text-[10px] text-tv-red">{createError}</p>
            )}
          </div>
        )}

        {/* Delete confirmation */}
        {deletingListId && (
          <div className="flex flex-col gap-1 px-3 pb-1.5">
            <p className="text-[10px] text-tv-text">
              Delete list &ldquo;{activeList?.name}&rdquo;? This cannot be undone.
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => handleDeleteList(deletingListId)}
                disabled={isDeletingRequest}
                className="rounded bg-tv-red/20 px-2 py-0.5 text-[10px] text-tv-red hover:bg-tv-red/30 disabled:opacity-40"
              >
                Delete
              </button>
              <button
                onClick={() => setDeletingListId(null)}
                className="rounded px-2 py-0.5 text-[10px] text-tv-text-muted hover:bg-tv-panel-hover"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {/* Search row */}
        <div className="px-2 pb-2 pt-1">
          <div className="relative">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeListId ? "Search tickers..." : "Create a list first"}
              disabled={!activeListId}
              aria-label="Search tickers to add to watchlist"
              className="w-full rounded bg-tv-bg-secondary px-2 py-1 text-xs text-tv-text placeholder-tv-text-muted outline-none border border-tv-border focus:border-tv-green disabled:opacity-50"
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded border border-tv-border bg-tv-bg-secondary shadow-lg max-h-48 overflow-y-auto">
                {isSearching && (
                  <div className="px-2 py-1 text-xs text-tv-text-muted">Searching...</div>
                )}
                {searchResults.map((r) => (
                  <div
                    key={r.symbol}
                    className="flex items-center justify-between px-2 py-1 hover:bg-tv-panel-hover"
                  >
                    <div>
                      <span className="text-xs font-bold text-tv-text">{r.symbol}</span>
                      <span className="ml-1 text-xs text-tv-text-muted">{r.shortname}</span>
                    </div>
                    <AddToWatchlistButton
                      symbol={r.symbol}
                      watchlistId={activeListId!}
                      onAdded={() => {
                        fetchItems(activeListId!);
                        setSearchQuery("");
                        setSearchOpen(false);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Symbol list ────────────────────────────────────────────────────── */}
      {itemsLoading ? (
        <div className="flex flex-1 flex-col gap-2 p-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-7 animate-pulse rounded bg-tv-panel-hover"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-tv-text-muted">
          No symbols yet. Search and add tickers above.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {items.map((item) => (
              <div
                key={item.id}
                className="group grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-tv-border px-3 py-1.5 text-xs"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-tv-text">{item.symbol}</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="tabular-nums text-tv-text">
                    {formatWatchlistPrice(item.price)}
                  </span>
                  <span className={cn("tabular-nums text-[10px]", getChangeColorClass(item.changePercent))}>
                    {formatWatchlistChange(item.changePercent)}
                  </span>
                </div>
                <button
                  onClick={() => handleDeleteItem(item.symbol)}
                  className="invisible rounded p-0.5 text-tv-text-muted hover:bg-tv-bg hover:text-tv-red group-hover:visible"
                  aria-label={`Remove ${item.symbol} from watchlist`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
