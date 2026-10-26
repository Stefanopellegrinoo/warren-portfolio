import { CARTERA_LIST_ID, useChartStore } from "@/lib/store/chart-store";
import { toast } from "sonner";

/**
 * Universal helper to add a symbol to the current active watchlist.
 * Handles both local (zustand) and remote (Supabase) watchlists.
 */
export async function addSymbolToCurrentWatchlist(symbol: string) {
  const store = useChartStore.getState();
  const activeId = store.activeWatchlistId;

  if (activeId === CARTERA_LIST_ID) {
    // Cartera is the stocks held: nothing is added to it by hand.
    const error = "Cartera se arma sola con tus acciones: elegí otra lista para agregar";
    toast.error(error);
    return { success: false, mode: 'cartera' as const, error };
  }

  if (!activeId) {
    // Local watchlist
    store.addToWatchlist(symbol);
    return { success: true, mode: 'local' as const };
  }

  // Remote watchlist
  try {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, watchlistId: activeId }),
    });

    if (res.ok) {
      store.bumpWatchlistRefresh();
      toast.success(`${symbol} agregado a la lista`);
      return { success: true, mode: 'remote' as const };
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.error || "No se pudo agregar el símbolo");
      return { success: false, mode: 'remote' as const, error: data?.error };
    }
  } catch {
    const error = "No se pudo agregar el ticker. Revisá tu conexión y probá de nuevo.";
    toast.error(error);
    return { success: false, mode: 'remote' as const, error };
  }
}
