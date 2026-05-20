"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface PriceAlert {
  id: string;
  ticker: string;
  type: string;
  operator: string;
  value: number;
  name: string;
  status: string;
  created_at: string;
  triggered_at: string | null;
}

function formatCondition(operator: string, value: number): string {
  if (operator === "crosses_above") return `cruza ${value.toFixed(2)} ↑`;
  if (operator === "crosses_below") return `baja ${value.toFixed(2)} ↓`;
  return `${operator} ${value.toFixed(2)}`;
}

export function PriceAlertsTab() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    async function loadAlerts() {
      try {
        const res = await fetch("/api/price-alerts");
        if (!res.ok) return;
        const body = await res.json();
        setAlerts(body.alerts ?? []);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    loadAlerts();
  }, []);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/price-alerts/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("failed");
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast.success("Alerta eliminada");
    } catch {
      toast.error("No se pudo eliminar la alerta");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 rounded-full border-2 border-amber border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-[#0d1829]/70 backdrop-blur-md border border-white/[0.06] rounded-2xl overflow-hidden">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <p className="text-slate-500 font-mono text-xs">
              No hay alertas activas · Se crean desde el gráfico
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 px-3 py-3">
                  Ticker
                </th>
                <th className="text-left text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 px-3 py-3">
                  Tipo
                </th>
                <th className="text-left text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 px-3 py-3">
                  Condición
                </th>
                <th className="text-left text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 px-3 py-3">
                  Estado
                </th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr
                  key={alert.id}
                  className={`border-b border-white/[0.04] last:border-0 ${
                    alert.status === "triggered" ? "opacity-40" : ""
                  }`}
                >
                  <td className="px-3 py-2.5 text-xs font-mono text-slate-400">
                    <span className="bg-amber/10 text-amber border border-amber/20 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {alert.ticker}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-slate-400">
                    <span className="bg-white/[0.06] text-slate-400 border border-white/[0.08] font-mono text-[10px] px-2 py-0.5 rounded-full">
                      {alert.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-white/65">
                    {formatCondition(alert.operator, alert.value)}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono">
                    {alert.status === "active" ? (
                      <span className="tag-positive">activa</span>
                    ) : (
                      <span className="tag-neutral">disparada</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => handleDelete(alert.id)}
                      disabled={deletingId === alert.id}
                      className="text-white/20 hover:text-rose-500 text-base bg-transparent border-none transition-colors disabled:opacity-50"
                      title="Eliminar alerta"
                    >
                      {deletingId === alert.id ? (
                        <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
                      ) : (
                        "×"
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-slate-500/50 text-[10px] font-mono text-right mt-2">
        Las alertas se crean desde el gráfico · Se auto-desactivan al dispararse
      </p>
    </div>
  );
}
