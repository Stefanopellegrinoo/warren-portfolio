"use client";

import Link from "next/link";
import { TrendingUp, LayoutDashboard, History, DollarSign, PieChart, BookOpen } from "lucide-react";
import { SymbolSelector } from "@/components/trading/chart/SymbolSelector";
import { TimeframeSelector } from "@/components/trading/chart/TimeframeSelector";
import { IndicatorMenu } from "@/components/trading/chart/IndicatorMenu";
import { Separator } from "@/components/ui/separator";
import { useChartStore } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard",  icon: LayoutDashboard, label: "Dashboard" },
  { href: "/history",    icon: History,          label: "Historial" },
  { href: "/cashflow",   icon: DollarSign,       label: "Cash Flow" },
  { href: "/statistics", icon: PieChart,          label: "Estadísticas" },
  { href: "/strategies", icon: BookOpen,          label: "Estrategias" },
];

interface HeaderProps {
  onSymbolSelect?: () => void;
}

export function Header({ onSymbolSelect }: HeaderProps = {}) {
  const dataSource = useChartStore((s) => s.dataSource);
  const setDataSource = useChartStore((s) => s.setDataSource);
  const showPortfolioOverlay = useChartStore((s) => s.showPortfolioOverlay);
  const togglePortfolioOverlay = useChartStore((s) => s.togglePortfolioOverlay);

  return (
    <header className="flex h-12 items-center justify-between border-b border-tv-border bg-tv-panel px-3">
      {/* Left: brand + chart controls */}
      <div className="flex items-center gap-1">
        {/* Warren brand */}
        <div className="flex items-center gap-2 pr-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20">
            <TrendingUp className="h-4 w-4 text-amber-400" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-bold tracking-tight text-white">WARREN</span>
        </div>

        <Separator orientation="vertical" className="hidden md:block h-6 bg-tv-border" />

        {/* DataSource toggle */}
        <div className="hidden md:flex items-center rounded bg-tv-bg p-0.5 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setDataSource("binance")}
            className={cn(
              "rounded px-2.5 py-1 transition-colors",
              dataSource === "binance"
                ? "bg-amber-500/20 text-amber-400"
                : "text-tv-text-muted hover:text-tv-text",
            )}
          >
            CRYPTO
          </button>
          <button
            type="button"
            onClick={() => setDataSource("yahoo")}
            className={cn(
              "rounded px-2.5 py-1 transition-colors",
              dataSource === "yahoo"
                ? "bg-amber-500/20 text-amber-400"
                : "text-tv-text-muted hover:text-tv-text",
            )}
          >
            STOCKS
          </button>
        </div>

        <Separator orientation="vertical" className="hidden md:block h-6 bg-tv-border" />
        <SymbolSelector onSymbolSelect={onSymbolSelect} />
        <Separator orientation="vertical" className="h-6 bg-tv-border" />
        <TimeframeSelector />
        <Separator orientation="vertical" className="mx-1 h-6 bg-tv-border" />
        <IndicatorMenu />

        {dataSource === "yahoo" && (
          <>
            <Separator orientation="vertical" className="mx-1 h-6 bg-tv-border" />
            <button
              type="button"
              onClick={togglePortfolioOverlay}
              title={showPortfolioOverlay ? "Ocultar overlay portfolio" : "Mostrar overlay portfolio"}
              className={cn(
                "flex items-center rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                showPortfolioOverlay
                  ? "bg-amber-500/20 text-amber-400"
                  : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
              )}
            >
              OVL
            </button>
          </>
        )}
      </div>

      {/* Right: compact app navigation */}
      <nav className="flex items-center gap-0.5">
        {NAV.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            title={label}
            className="flex items-center justify-center rounded p-2 text-tv-text-muted transition-colors hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <Icon className="h-4 w-4" />
          </Link>
        ))}
      </nav>
    </header>
  );
}
