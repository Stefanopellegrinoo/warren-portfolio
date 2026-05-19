import { useChartStore } from "@/lib/store/chart-store";

/**
 * Universal helper to add a symbol to the current active watchlist.
 * Handles both local (zustand) and remote (Supabase) watchlists.
 */
export async function addSymbolToCurrentWatchlist(symbol: string) {
  const store = useChartStore.getState();
  const activeId = store.activeWatchlistId;

  if (!activeId) {
    // Local watchlist
    store.addToWatchlist(symbol);
    return { success: true, mode: 'local' };
  }

  // Remote watchlist
  try {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbol, watchlistId: activeId }),
    });

    if (res.ok) {
      // We don't necessarily need to update the store here because 
      // the Watchlist component is listening to activeId changes 
      // and re-fetching, BUT adding to local state would make it feel faster.
      // However, for simplicity and to avoid duplicated sources of truth, 
      // we just return success.
      return { success: true, mode: 'remote' };
    } else {
      const data = await res.json();
      return { success: false, error: data.error };
    }
  } catch (e) {
    return { success: false, error: "Network error" };
  }
}
