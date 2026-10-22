"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { TradingDialog, field, ghostButton, primaryButton } from "@/components/trading/ui";
import {
  useChartStore,
  DEFAULT_CONFIG,
  type IndicatorKey,
} from "@/lib/store/chart-store";

const TITLES: Record<IndicatorKey, string> = {
  ema20: "EMA 1",
  ema50: "EMA 2",
  ema200: "EMA 3",
  rsi: "RSI",
  macd: "MACD",
  volume: "Volumen",
  bollinger: "Bollinger Bands",
  obv: "OBV",
  stochastic: "Stochastic",
  adx: "ADX",
};

export function IndicatorSettingsDialog() {
  const target = useChartStore((s) => s.settingsTarget);
  const setTarget = useChartStore((s) => s.setSettingsTarget);
  const config = useChartStore((s) => s.config);
  const setConfig = useChartStore((s) => s.setConfig);

  const open = target !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setTarget(null);
      }}
    >
      <TradingDialog title={target ? `Configurar ${TITLES[target]}` : ""} width={384}>
        {target && (
          <SettingsForm
            target={target}
            config={config}
            onSave={(patch) => {
              setConfig(patch);
              setTarget(null);
            }}
            onReset={() => {
              setConfig(DEFAULT_CONFIG);
              setTarget(null);
            }}
          />
        )}
      </TradingDialog>
    </Dialog>
  );
}

interface FormProps {
  target: IndicatorKey;
  config: typeof DEFAULT_CONFIG;
  onSave: (patch: Partial<typeof DEFAULT_CONFIG>) => void;
  onReset: () => void;
}

function SettingsForm({ target, config, onSave, onReset }: FormProps) {
  // Local draft state to avoid recalculating chart on every keystroke
  const [draft, setDraft] = useState({
    ema20: config.ema20,
    ema50: config.ema50,
    ema200: config.ema200,
    rsi: config.rsi,
    macdFast: config.macdFast,
    macdSlow: config.macdSlow,
    macdSignal: config.macdSignal,
    bbPeriod: config.bbPeriod,
    bbStdDev: config.bbStdDev,
    stochK: config.stochK,
    stochSmooth: config.stochSmooth,
    stochD: config.stochD,
    adxPeriod: config.adxPeriod,
  });

  useEffect(() => {
    setDraft({
      ema20: config.ema20,
      ema50: config.ema50,
      ema200: config.ema200,
      rsi: config.rsi,
      macdFast: config.macdFast,
      macdSlow: config.macdSlow,
      macdSignal: config.macdSignal,
      bbPeriod: config.bbPeriod,
      bbStdDev: config.bbStdDev,
      stochK: config.stochK,
      stochSmooth: config.stochSmooth,
      stochD: config.stochD,
      adxPeriod: config.adxPeriod,
    });
  }, [config, target]);

  function save() {
    if (target === "ema20") onSave({ ema20: clamp(draft.ema20, 2, 500) });
    else if (target === "ema50") onSave({ ema50: clamp(draft.ema50, 2, 500) });
    else if (target === "ema200") onSave({ ema200: clamp(draft.ema200, 2, 500) });
    else if (target === "rsi") onSave({ rsi: clamp(draft.rsi, 2, 100) });
    else if (target === "macd")
      onSave({
        macdFast: clamp(draft.macdFast, 2, 100),
        macdSlow: clamp(draft.macdSlow, 2, 200),
        macdSignal: clamp(draft.macdSignal, 2, 100),
      });
    else if (target === "volume") onSave({});
    else if (target === "bollinger")
      onSave({ bbPeriod: clamp(draft.bbPeriod, 2, 500), bbStdDev: clamp(draft.bbStdDev, 1, 5) });
    else if (target === "obv") onSave({});
    else if (target === "stochastic")
      onSave({
        stochK: clamp(draft.stochK, 1, 100),
        stochSmooth: clamp(draft.stochSmooth, 1, 20),
        stochD: clamp(draft.stochD, 1, 20),
      });
    else if (target === "adx") onSave({ adxPeriod: clamp(draft.adxPeriod, 2, 100) });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {(target === "ema20" || target === "ema50" || target === "ema200") && (
        <Field
          label="Período"
          value={draft[target]}
          onChange={(n) => setDraft((d) => ({ ...d, [target]: n }))}
        />
      )}
      {target === "rsi" && (
        <Field
          label="Período"
          value={draft.rsi}
          onChange={(n) => setDraft((d) => ({ ...d, rsi: n }))}
        />
      )}
      {target === "macd" && (
        <div className="grid grid-cols-3 gap-2">
          <Field
            label="Rápida"
            value={draft.macdFast}
            onChange={(n) => setDraft((d) => ({ ...d, macdFast: n }))}
          />
          <Field
            label="Lenta"
            value={draft.macdSlow}
            onChange={(n) => setDraft((d) => ({ ...d, macdSlow: n }))}
          />
          <Field
            label="Señal"
            value={draft.macdSignal}
            onChange={(n) => setDraft((d) => ({ ...d, macdSignal: n }))}
          />
        </div>
      )}
      {target === "volume" && (
        <p className="text-[13px] text-ink-3">
          El indicador de volumen no tiene parámetros configurables en esta
          versión.
        </p>
      )}
      {target === "bollinger" && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Período"
            value={draft.bbPeriod}
            onChange={(n) => setDraft((d) => ({ ...d, bbPeriod: n }))}
          />
          <Field
            label="Desv. estándar"
            value={draft.bbStdDev}
            onChange={(n) => setDraft((d) => ({ ...d, bbStdDev: n }))}
          />
        </div>
      )}
      {target === "obv" && (
        <p className="text-[13px] text-ink-3">
          OBV no tiene parámetros configurables.
        </p>
      )}
      {target === "stochastic" && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <Field
              label="K"
              value={draft.stochK}
              onChange={(n) => setDraft((d) => ({ ...d, stochK: n }))}
            />
            <Field
              label="Suavizado"
              value={draft.stochSmooth}
              onChange={(n) => setDraft((d) => ({ ...d, stochSmooth: n }))}
            />
            <Field
              label="D"
              value={draft.stochD}
              onChange={(n) => setDraft((d) => ({ ...d, stochD: n }))}
            />
          </div>
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, stochK: 21, stochSmooth: 5, stochD: 5 }))}
            className={`${ghostButton} self-start`}
          >
            Largo plazo (21, 5, 5)
          </button>
        </div>
      )}
      {target === "adx" && (
        <Field
          label="Período"
          value={draft.adxPeriod}
          onChange={(n) => setDraft((d) => ({ ...d, adxPeriod: n }))}
        />
      )}

      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={onReset} className={ghostButton}>
          Restablecer valores
        </button>
        <button type="button" onClick={save} className={primaryButton}>
          Aplicar
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <input
        type="number"
        min={2}
        max={500}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(n);
        }}
        className={field}
      />
    </label>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
