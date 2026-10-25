"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Chip, SectionHead } from "@/components/resumen/ui";
import { conditionText } from "@/lib/chart/alerts";
import type { AlertCondition } from "@/lib/chart/alert-condition";
import { ErrorNotice, SkeletonRows, ghostButton, iconButton } from "./ui";
import { PushSettings } from "./PushSettings";

export interface PriceAlert {
  id: string;
  ticker: string;
  type: string;
  operator: string;
  value: number | null;
  name: string;
  status: string;
  created_at: string;
  triggered_at: string | null;
  // Migration 052 (odd/tasks/chart-customization.md S6); a row from before has none: the price against its value.
  source?: string;
  target?: string;
  timeframe?: string | null;
  periods?: Record<string, number> | null;
  color?: string | null;
}

// The condition in words: "Supera 195,00" as always, "Precio cruza EMA 50 (1D) · cualquiera" for the new ones.
const formatCondition = (a: PriceAlert) =>
  conditionText({
    source: a.source ?? "price",
    target: a.target ?? "value",
    operator: a.operator as AlertCondition["operator"],
    value: a.value,
    timeframe: (a.timeframe ?? null) as AlertCondition["timeframe"],
    periods: a.periods ?? null,
  });

const STATES: Record<string, { label: string; tone: "ok" | "neutral" | "danger" }> = {
  active: { label: "Activa", tone: "ok" },
  triggered: { label: "Disparada", tone: "neutral" },
  unavailable: { label: "No se puede revisar", tone: "danger" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function AlertsList({ alerts, busyId, onDelete, onRearm }: {
  alerts: PriceAlert[];
  busyId: string | null;
  onDelete: (id: string) => void;
  onRearm: (id: string) => void;
}) {
  return (
    <ul>
      {alerts.map((a) => {
        const triggered = a.status === "triggered";
        const state = STATES[a.status] ?? STATES.active;
        const busy = busyId === a.id;
        return (
          <li key={a.id} className="grid min-h-[56px] grid-cols-[96px_minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-1 border-b border-line py-2 last:border-b-0 max-[819px]:grid-cols-[minmax(0,1fr)_auto]">
            <Link href={`/trading?symbol=${encodeURIComponent(a.ticker)}`} className="font-semibold hover:text-accent-ink max-[819px]:inline-flex max-[819px]:min-h-11 max-[819px]:items-center">
              {a.ticker}
            </Link>
            <span className="min-w-0 tabular-nums max-[819px]:order-3">
              {formatCondition(a)}
              {triggered && a.triggered_at && (
                <small className="ml-2 text-[13px] text-ink-3">el {when(a.triggered_at)}</small>
              )}
            </span>
            <Chip tone={state.tone} className="justify-self-start max-[819px]:order-2 max-[819px]:justify-self-end">
              {state.label}
            </Chip>
            <span className="flex items-center justify-end gap-1 max-[819px]:order-4">
              {a.status !== "active" && (
                <button type="button" onClick={() => onRearm(a.id)} disabled={busy} aria-busy={busy} aria-label={`Reactivar la alerta de ${a.ticker}`} className={ghostButton}>
                  Reactivar
                </button>
              )}
              <button type="button" onClick={() => onDelete(a.id)} disabled={busy} aria-busy={busy} aria-label={`Eliminar la alerta de ${a.ticker}`} title="Eliminar" className={`${iconButton} hover:text-danger`}>
                <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PriceAlertsTab() {
  const [alerts, setAlerts] = useState<PriceAlert[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    fetch("/api/price-alerts")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body) => setAlerts(body.alerts ?? []))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/price-alerts/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("failed");
      setAlerts((prev) => (prev ?? []).filter((a) => a.id !== id));
      toast.success("Alerta eliminada");
    } catch {
      toast.error("No se pudo eliminar la alerta");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRearm(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/price-alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) throw new Error("failed");
      const body = (await res.json()) as { alert: PriceAlert };
      setAlerts((prev) => (prev ?? []).map((a) => (a.id === id ? { ...a, ...body.alert } : a)));
      toast.success("Alerta reactivada");
    } catch {
      toast.error("No se pudo reactivar la alerta");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="h-alertas">
      <SectionHead id="h-alertas" title="Alertas de precio" count={alerts?.length} />
      <PushSettings />
      {loadError && <div className="pt-3"><ErrorNotice onRetry={load}>No se pudieron cargar las alertas.</ErrorNotice></div>}
      {!loadError && alerts === null && <SkeletonRows label="Cargando alertas" rows={3} />}
      {alerts !== null && alerts.length === 0 && (
        <p className="py-6 text-ink-2">
          Todavía no creaste alertas. Se crean desde{" "}
          <Link href="/trading" className="font-medium text-accent-ink underline underline-offset-2">Gráficos</Link>.
        </p>
      )}
      {alerts !== null && alerts.length > 0 && (
        <AlertsList alerts={alerts} busyId={busyId} onDelete={handleDelete} onRearm={handleRearm} />
      )}
      <p className="mt-4 text-[13px] text-ink-3">
        Las alertas se crean desde Gráficos. Cuando se disparan te avisamos en los dispositivos donde activaste los avisos, y dejan de vigilar el precio hasta que las reactivás.
      </p>
    </section>
  );
}
