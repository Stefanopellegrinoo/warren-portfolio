"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ListPlus, Trash2, Edit2 } from "lucide-react";
import { useChartStore } from "@/lib/store/chart-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog } from "@/components/ui/dialog";
import { TradingDialog, dangerButton, field, ghostButton, iconButton, primaryButton } from "@/components/trading/ui";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { NO_CONNECTION } from "@/lib/request-errors";

const LOCAL_NAME = "Lista local";

interface WatchlistInfo {
  id: string;
  name: string;
  item_count: number;
}

async function extractError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function WatchlistSelector() {
  const activeId = useChartStore((s) => s.activeWatchlistId);
  const setActiveId = useChartStore((s) => s.setActiveWatchlistId);

  const [lists, setLists] = useState<WatchlistInfo[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [editingList, setEditingList] = useState<WatchlistInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Open edit dialog only after the dropdown has fully closed to avoid
  // @base-ui/react identity/focus conflict (error #31).
  useEffect(() => {
    if (editingList && !dropdownOpen) {
      setShowEditDialog(true);
    }
  }, [editingList, dropdownOpen]);

  // Open delete confirm dialog only after dropdown has fully closed (same Base UI pattern).
  useEffect(() => {
    if (pendingDeleteId && !dropdownOpen) {
      setShowDeleteDialog(true);
    }
  }, [pendingDeleteId, dropdownOpen]);

  async function fetchLists() {
    try {
      const res = await fetch("/api/watchlist/lists");
      if (res.ok) {
        const data = await res.json();
        setLists(data.lists);
      } else {
        const msg = await extractError(res, "No se pudieron cargar las listas");
        toast.error(msg);
      }
    } catch {
      toast.error("No se pudieron cargar las listas", { description: NO_CONNECTION });
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchLists();
        setActiveId(data.id);
        setShowCreateDialog(false);
        setNewListName("");
        toast.success("Lista creada");
      } else {
        const msg = await extractError(res, "No se pudo crear la lista");
        toast.error(msg);
      }
    } catch {
      toast.error("No se pudo crear la lista", { description: NO_CONNECTION });
    } finally {
      setLoading(false);
    }
  }

  async function handleRenameList() {
    if (!editingList || !newListName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/watchlist/lists/${editingList.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName }),
      });
      if (res.ok) {
        await fetchLists();
        setShowEditDialog(false);
        setNewListName("");
        setEditingList(null);
        toast.success("Lista renombrada");
      } else {
        const msg = await extractError(res, "No se pudo renombrar la lista");
        toast.error(msg);
      }
    } catch {
      toast.error("No se pudo renombrar la lista", { description: NO_CONNECTION });
    } finally {
      setLoading(false);
    }
  }

  function requestDeleteList(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setPendingDeleteId(id);
    setDropdownOpen(false);
  }

  async function confirmDeleteList() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    try {
      const res = await fetch(`/api/watchlist/lists/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (activeId === id) setActiveId(null);
        await fetchLists();
        toast.success("Lista eliminada");
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || "No se pudo eliminar la lista");
      }
    } catch {
      toast.error("No se pudo eliminar la lista", { description: NO_CONNECTION });
    } finally {
      setPendingDeleteId(null);
      setShowDeleteDialog(false);
    }
  }

  const activeListName = activeId
    ? lists.find((l) => l.id === activeId)?.name || "Cargando…"
    : LOCAL_NAME;
  const activeCount = activeId ? lists.find((l) => l.id === activeId)?.item_count : undefined;

  const itemClass = (active: boolean) => cn(
    "group flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded px-2 text-[13px] text-ink outline-none focus:bg-hover focus:text-ink data-[highlighted]:bg-hover max-[819px]:min-h-11",
    active && "font-medium",
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-sm font-semibold text-ink hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:min-h-11">
          <span className="truncate">{activeListName}</span>
          {activeCount !== undefined && <span className="font-normal tabular-nums text-ink-3">{activeCount}</span>}
          <ChevronDown className="h-4 w-4 flex-none text-ink-3" strokeWidth={1.5} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-32px)] rounded-lg border border-line bg-surface p-1 text-ink shadow-pop ring-0">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs font-medium text-ink-3">Tus listas</DropdownMenuLabel>
          </DropdownMenuGroup>
          <div className="max-h-[300px] overflow-y-auto">
            <DropdownMenuItem onClick={() => setActiveId(null)} className={itemClass(!activeId)}>
              <span className="truncate">{LOCAL_NAME}</span>
              {!activeId && <Check className="h-4 w-4 flex-none text-accent" strokeWidth={1.5} aria-label="Lista actual" />}
            </DropdownMenuItem>

            {lists.map((l) => (
              <DropdownMenuItem key={l.id} onClick={() => setActiveId(l.id)} className={itemClass(activeId === l.id)}>
                <span className="truncate">{l.name}</span>
                <span className="flex flex-none items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`Renombrar ${l.name}`}
                    title="Renombrar"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewListName(l.name);
                      setEditingList(l);
                      setDropdownOpen(false);
                    }}
                    className="grid h-7 w-7 place-items-center rounded text-ink-3 opacity-0 hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-data-[highlighted]:opacity-100 max-[819px]:h-9 max-[819px]:w-9 max-[819px]:opacity-100"
                  >
                    <Edit2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Eliminar ${l.name}`}
                    title="Eliminar"
                    onClick={(e) => requestDeleteList(l.id, e)}
                    className="grid h-7 w-7 place-items-center rounded text-ink-3 opacity-0 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 group-data-[highlighted]:opacity-100 max-[819px]:h-9 max-[819px]:w-9 max-[819px]:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                  {activeId === l.id && <Check className="h-4 w-4 text-accent" strokeWidth={1.5} aria-label="Lista actual" />}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside the dropdown to avoid the Base UI focus conflict. */}
      <button
        type="button"
        aria-label="Nueva lista"
        title="Nueva lista"
        onClick={() => {
          setNewListName("");
          setShowCreateDialog(true);
        }}
        className={iconButton}
      >
        <ListPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      </button>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <TradingDialog title="Nueva lista" width={340}>
          <NameForm
            value={newListName}
            onChange={setNewListName}
            onSubmit={handleCreateList}
            onCancel={() => setShowCreateDialog(false)}
            submitLabel="Crear"
            busy={loading}
          />
        </TradingDialog>
      </Dialog>

      <Dialog
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open);
          if (!open) setEditingList(null);
        }}
      >
        <TradingDialog title="Renombrar lista" width={340}>
          <NameForm
            value={newListName}
            onChange={setNewListName}
            onSubmit={handleRenameList}
            onCancel={() => {
              setShowEditDialog(false);
              setEditingList(null);
            }}
            submitLabel="Guardar"
            busy={loading}
          />
        </TradingDialog>
      </Dialog>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteId(null);
            setShowDeleteDialog(false);
          }
        }}
      >
        <TradingDialog title="Eliminar lista" width={360}>
          <p className="p-4 text-sm text-ink-2">
            ¿Querés eliminar esta lista? Esta acción no se puede deshacer.
          </p>
          <div className="flex justify-end gap-2 px-4 pb-4">
            <button
              type="button"
              onClick={() => {
                setPendingDeleteId(null);
                setShowDeleteDialog(false);
              }}
              className={ghostButton}
            >
              Cancelar
            </button>
            <button type="button" onClick={confirmDeleteList} className={dangerButton}>
              Eliminar
            </button>
          </div>
        </TradingDialog>
      </Dialog>
    </div>
  );
}

function NameForm({ value, onChange, onSubmit, onCancel, submitLabel, busy }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="grid gap-4 p-4"
    >
      <label className="grid gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Nombre</span>
        <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} className={field} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={ghostButton}>Cancelar</button>
        <button type="submit" disabled={busy || !value.trim()} aria-busy={busy} className={primaryButton}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
