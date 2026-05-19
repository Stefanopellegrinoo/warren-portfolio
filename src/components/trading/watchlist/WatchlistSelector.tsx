"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, List, Trash2, Edit2, MoreVertical } from "lucide-react";
import { useChartStore } from "@/lib/store/chart-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface WatchlistInfo {
  id: string;
  name: string;
  item_count: number;
}

export function WatchlistSelector() {
  const activeId = useChartStore((s) => s.activeWatchlistId);
  const setActiveId = useChartStore((s) => s.setActiveWatchlistId);
  
  const [lists, setLists] = useState<WatchlistInfo[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [editingList, setEditingList] = useState<WatchlistInfo | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchLists() {
    try {
      const res = await fetch("/api/watchlist/lists");
      if (res.ok) {
        const data = await res.json();
        setLists(data.lists);
      }
    } catch (e) {
      console.error("Failed to fetch lists", e);
    }
  }

  useEffect(() => {
    fetchLists();
  }, []);

  async function handleCreateList() {
    if (!newListName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist/lists", {
        method: "POST",
        body: JSON.stringify({ name: newListName }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchLists();
        setActiveId(data.id);
        setShowCreateDialog(false);
        setNewListName("");
      }
    } catch {} finally { setLoading(false); }
  }

  async function handleRenameList() {
    if (!editingList || !newListName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/watchlist/lists/${editingList.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: newListName }),
      });
      if (res.ok) {
        await fetchLists();
        setShowEditDialog(false);
        setNewListName("");
        setEditingList(null);
      }
    } catch {} finally { setLoading(false); }
  }

  async function handleDeleteList(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("¿Estás seguro de que querés eliminar esta lista?")) return;
    try {
      const res = await fetch(`/api/watchlist/lists/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (activeId === id) setActiveId(null);
        await fetchLists();
      } else {
        const data = await res.json();
        toast.error(data.error || "No se pudo eliminar la lista");
      }
    } catch {}
  }

  const activeListName = activeId 
    ? lists.find(l => l.id === activeId)?.name || "Cargando..." 
    : "Watchlist Local";

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-tv-border bg-tv-panel/40">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-tv-text hover:text-tv-blue transition-colors group outline-none">
          <List className="h-3 w-3 text-tv-text-dim group-hover:text-tv-blue" />
          {activeListName}
          <ChevronDown className="h-3 w-3 text-tv-text-dim group-hover:text-tv-blue" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 bg-tv-panel border-tv-border text-tv-text p-1 shadow-2xl">
          <DropdownMenuLabel className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-tv-text-dim/60">
            Tus Listas
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-tv-border/50 mx-1" />
          
          <div className="max-h-[300px] overflow-y-auto py-1">
            <DropdownMenuItem 
              onClick={() => setActiveId(null)}
              className={cn(
                "flex items-center justify-between text-xs py-2 px-3 cursor-pointer rounded-sm outline-none transition-colors",
                !activeId ? "bg-tv-blue/10 text-tv-blue" : "hover:bg-tv-panel-hover"
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2.5">
                  <List className={cn("h-3.5 w-3.5", !activeId ? "text-tv-blue" : "text-tv-text-dim")} />
                  <span className="font-medium">Watchlist Local</span>
                </div>
                {!activeId && <div className="w-1.5 h-1.5 rounded-full bg-tv-blue shadow-[0_0_8px_rgba(41,98,255,0.6)]" />}
              </div>
            </DropdownMenuItem>
            
            {lists.map((l) => (
              <DropdownMenuItem 
                key={l.id}
                onClick={() => setActiveId(l.id)}
                className={cn(
                  "flex items-center justify-between text-xs py-2 px-3 cursor-pointer rounded-sm outline-none group transition-colors",
                  activeId === l.id ? "bg-tv-blue/10 text-tv-blue" : "hover:bg-tv-panel-hover"
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2.5">
                    <List className={cn("h-3.5 w-3.5", activeId === l.id ? "text-tv-blue" : "text-tv-text-dim")} />
                    <span className="font-medium">{l.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingList(l);
                        setNewListName(l.name);
                        setTimeout(() => setShowEditDialog(true), 0);
                      }}
                      className="p-1 rounded hover:bg-tv-bg text-tv-text-dim hover:text-tv-text opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteList(l.id, e)}
                      className="p-1 rounded hover:bg-tv-red/20 text-tv-text-dim hover:text-tv-red opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    {activeId === l.id && <div className="w-1.5 h-1.5 rounded-full bg-tv-blue shadow-[0_0_8px_rgba(41,98,255,0.6)]" />}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
          
          <DropdownMenuSeparator className="bg-tv-border/50 mx-1" />
          
          <DropdownMenuItem 
            onClick={() => {
              setNewListName("");
              setTimeout(() => setShowCreateDialog(true), 0);
            }}
            className="flex items-center gap-2.5 text-xs py-2 px-3 cursor-pointer rounded-sm outline-none text-tv-blue hover:bg-tv-blue/5 font-semibold mt-1"
          >
            <Plus className="h-4 w-4" />
            Crear nueva lista...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-1">
        <span className="text-[10px] text-tv-text-dim/40 font-mono">
          {activeId ? lists.find(l => l.id === activeId)?.item_count || 0 : "∞"}
        </span>
      </div>

      {/* Dialogs */}
      <Dialog key="dialog-create" open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-tv-panel border-tv-border text-tv-text sm:max-w-[320px] shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xs font-bold uppercase tracking-[0.2em] text-tv-text-dim">Nueva Watchlist</DialogTitle>
          </DialogHeader>
          <div className="py-6">
            <Input
              placeholder="Nombre de la lista"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              className="bg-tv-bg border-tv-border text-xs h-9 focus:border-tv-blue focus:ring-tv-blue/20"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreateList()}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => setShowCreateDialog(false)}
              className="border-tv-border text-[11px] h-8 font-bold uppercase tracking-wider hover:bg-tv-panel-hover"
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleCreateList}
              disabled={loading || !newListName.trim()}
              className="bg-tv-blue hover:bg-tv-blue/90 text-white text-[11px] h-8 font-bold uppercase tracking-wider px-6"
            >
              {loading ? "..." : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog key="dialog-edit" open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-tv-panel border-tv-border text-tv-text sm:max-w-[320px] shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xs font-bold uppercase tracking-[0.2em] text-tv-text-dim">Renombrar Lista</DialogTitle>
          </DialogHeader>
          <div className="py-6">
            <Input
              placeholder="Nombre de la lista"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              className="bg-tv-bg border-tv-border text-xs h-9 focus:border-tv-blue focus:ring-tv-blue/20"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleRenameList()}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowEditDialog(false);
                setEditingList(null);
              }}
              className="border-tv-border text-[11px] h-8 font-bold uppercase tracking-wider hover:bg-tv-panel-hover"
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleRenameList}
              disabled={loading || !newListName.trim()}
              className="bg-tv-blue hover:bg-tv-blue/90 text-white text-[11px] h-8 font-bold uppercase tracking-wider px-6"
            >
              {loading ? "..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
