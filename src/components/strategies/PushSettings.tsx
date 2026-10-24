"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { requestErrorMessage } from "@/lib/request-errors";
import { ghostButton, primaryButton, secondaryButton } from "./ui";

type State = "checking" | "install" | "unavailable" | "not-configured" | "denied" | "off" | "on";

/** How long to wait for the service worker before saying this browser cannot receive pushes. */
const READY_TIMEOUT_MS = 4000;

// The VAPID key travels as base64url; the browser wants its raw bytes.
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const raw = atob((base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const isIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const supportsPush = () => "serviceWorker" in navigator && typeof window.PushManager === "function" && "Notification" in window;

function registration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS)),
  ]);
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

/** What this device can do right now, and the public key when it can subscribe. */
async function detect(): Promise<{ state: State; key: string | null; reg: ServiceWorkerRegistration | null }> {
  // iOS offers push only to the app opened from the Home Screen.
  if (!supportsPush()) return { state: isIphone() ? "install" : "unavailable", key: null, reg: null };
  if (Notification.permission === "denied") return { state: "denied", key: null, reg: null };
  const reg = await registration();
  if (!reg) return { state: "unavailable", key: null, reg: null };
  if (await reg.pushManager.getSubscription()) return { state: "on", key: null, reg };
  // The key and the registration are ready before the tap: iOS keeps the tap only until the first await.
  const res = await fetch("/api/push").catch(() => null);
  if (res?.status === 503) return { state: "not-configured", key: null, reg };
  const body = res?.ok ? await res.json().catch(() => null) : null;
  return { state: "off", key: typeof body?.publicKey === "string" ? body.publicKey : null, reg };
}

const COPY: Record<Exclude<State, "checking" | "off" | "on">, string> = {
  install: "Para recibir avisos en el iPhone, agregá Warren a la pantalla de inicio (Compartir → Agregar a inicio) y abrila desde ahí.",
  unavailable: "Este navegador no puede recibir avisos de Warren. Abrí la app instalada en tu celular.",
  "not-configured": "Los avisos todavía no están configurados en el servidor.",
  denied: "Bloqueaste los avisos de Warren. Para activarlos, entrá en Ajustes → Notificaciones → Warren en el iPhone, o en los permisos del sitio en el navegador.",
};

/** "Avisos en este dispositivo": turns the push notifications of price alerts on and off for this device. */
export function PushSettings() {
  const [state, setState] = useState<State>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reg = useRef<ServiceWorkerRegistration | null>(null);

  const check = useCallback(() => {
    void detect().then((found) => { reg.current = found.reg; setState(found.state); setPublicKey(found.key); });
  }, []);

  useEffect(() => { check(); }, [check]);

  async function activate() {
    setBusy(true);
    let subscription: PushSubscription | null = null;
    try {
      if (!reg.current || !publicKey) throw new Error("No se pudieron activar los avisos. Recargá la página y probá de nuevo.");
      try {
        // The first await of the tap: the browser's permission prompt.
        subscription = await reg.current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      } catch {
        if (Notification.permission === "denied") return setState("denied");
        throw new Error("Sin tu permiso no podemos avisarte. Tocá Activar avisos y elegí Permitir.");
      }
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error(await errorOf(res, "No se pudieron activar los avisos"));
      setState("on");
      toast.success("Avisos activados en este dispositivo");
    } catch (err) {
      // A device the server does not know must not stay subscribed in the browser.
      await subscription?.unsubscribe().catch(() => {});
      toast.error(requestErrorMessage(err, "No se pudieron activar los avisos"));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    try {
      const subscription = await reg.current?.pushManager.getSubscription();
      if (subscription) {
        const res = await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!res.ok) throw new Error(await errorOf(res, "No se pudieron desactivar los avisos"));
        await subscription.unsubscribe();
      }
      setState("off");
      toast.success("Avisos desactivados en este dispositivo");
      check();
    } catch (err) {
      toast.error(requestErrorMessage(err, "No se pudieron desactivar los avisos"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      if (!res.ok) throw new Error(await errorOf(res, "No se pudo enviar la prueba"));
      toast.success("Te mandamos una prueba: debería llegarte en unos segundos.");
    } catch (err) {
      toast.error(requestErrorMessage(err, "No se pudo enviar la prueba"));
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") return null;
  return (
    <section aria-labelledby="h-avisos" className="mt-3 grid gap-3 rounded-md border border-line px-4 py-3">
      <h3 id="h-avisos" className="text-sm font-semibold">Avisos en este dispositivo</h3>
      {state === "off" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">Te avisamos con una notificación cuando se dispara una alerta.</p>
          <button type="button" className={primaryButton} disabled={busy} onClick={() => void activate()}>Activar avisos</button>
        </div>
      )}
      {state === "on" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">Este dispositivo recibe los avisos.</p>
          <span className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => void sendTest()}>Enviar una prueba</button>
            <button type="button" className={ghostButton} disabled={busy} onClick={() => void deactivate()}>Desactivar</button>
          </span>
        </div>
      )}
      {state !== "off" && state !== "on" && <p className="text-sm text-ink-2">{COPY[state]}</p>}
    </section>
  );
}
