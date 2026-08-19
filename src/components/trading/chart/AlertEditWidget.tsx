"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface PriceAlert {
  id: string;
  user_id: string;
  ticker: string;
  type: string;
  operator: string;
  value: number;
  name: string;
  channel: string;
  status: string;
  created_at: string;
  triggered_at: string | null;
}

interface Props {
  alert: PriceAlert;
  symbol: string;
  onClose: () => void;
  onUpdated: (alert: PriceAlert) => void;
  onDeleted: (id: string) => void;
}

export function AlertEditWidget({ alert, symbol, onClose, onUpdated, onDeleted }: Props) {
  const [name, setName] = useState(alert.name);
  const [operator, setOperator] = useState<"crosses_above" | "crosses_below">(
    alert.operator === "crosses_below" ? "crosses_below" : "crosses_above"
  );
  const [value, setValue] = useState(alert.value.toFixed(2));
  const [channel, setChannel] = useState(alert.channel ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSave() {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      toast.error("Valor inválido");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/price-alerts/${alert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, operator, value: parsed, channel }),
      });
      if (!res.ok) throw new Error("failed");
      const body = await res.json();
      toast.success("Alerta actualizada");
      onUpdated(body.alert);
    } catch {
      toast.error("Error al guardar la alerta");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/price-alerts/${alert.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      toast.success("Alerta eliminada");
      onDeleted(alert.id);
    } catch {
      toast.error("Error al eliminar la alerta");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto w-80 bg-[#0d1829]/90 backdrop-blur-md border border-white/[0.06] rounded-2xl shadow-xl p-5 flex flex-col gap-4">
        <p className="text-sm font-bold text-white">Editar alerta</p>

        {/* Ticker */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Ticker</span>
          <span className="text-xs font-mono text-amber bg-amber/10 border border-amber/20 px-2 py-1 rounded-lg w-fit">
            {symbol}
          </span>
        </div>

        {/* Nombre */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Nombre</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber/40"
          />
        </div>

        {/* Condición */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Condición</span>
          <div className="flex gap-2">
            <button
              onClick={() => setOperator("crosses_above")}
              className={`flex-1 text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
                operator === "crosses_above"
                  ? "bg-amber/10 text-amber border-amber/20"
                  : "bg-white/[0.03] text-slate-400 border-white/[0.08] hover:bg-white/[0.06]"
              }`}
            >
              ≥ Sube a
            </button>
            <button
              onClick={() => setOperator("crosses_below")}
              className={`flex-1 text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
                operator === "crosses_below"
                  ? "bg-amber/10 text-amber border-amber/20"
                  : "bg-white/[0.03] text-slate-400 border-white/[0.08] hover:bg-white/[0.06]"
              }`}
            >
              ≤ Baja a
            </button>
          </div>
        </div>

        {/* Valor */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Valor</span>
          <input
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber/40"
          />
        </div>

        {/* Canal */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Canal</span>
          <div className="flex gap-2">
            <button
              onClick={() => setChannel("telegram")}
              className={`flex-1 text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
                channel === "telegram"
                  ? "bg-amber/10 text-amber border-amber/20"
                  : "bg-white/[0.03] text-slate-400 border-white/[0.08] hover:bg-white/[0.06]"
              }`}
            >
              Telegram
            </button>
            <button
              onClick={() => setChannel("email")}
              className={`flex-1 text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
                channel === "email"
                  ? "bg-amber/10 text-amber border-amber/20"
                  : "bg-white/[0.03] text-slate-400 border-white/[0.08] hover:bg-white/[0.06]"
              }`}
            >
              Email
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleSave}
            disabled={saving || deleting}
            className="w-full text-xs font-mono bg-amber/10 text-amber border border-amber/20 hover:bg-amber/20 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button
            onClick={handleDelete}
            disabled={saving || deleting}
            className="w-full text-xs font-mono bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? "Eliminando…" : "Eliminar"}
          </button>
          <button
            onClick={onClose}
            className="w-full text-xs font-mono text-slate-500 hover:text-slate-300 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
