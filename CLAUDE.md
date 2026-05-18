# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js dev server (localhost:3000)
npm run type-check   # TypeScript check (no emit)
npm run lint         # ESLint
npm run test         # Vitest (all tests)
npm run worker       # Start BullMQ price-update background worker

# Run a single test file
npx vitest run src/lib/__tests__/portfolio-engine.test.ts

# Full stack with Redis (Docker)
docker-compose up
```

**Required env vars** (copy `.env.local.example` → `.env.local`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDIS_URL` (defaults to `redis://localhost:6379`)

## Production Deployment

App lives at `https://portfolio.fratellipastas.com/` — self-hosted with Docker Compose behind Nginx.

```bash
# On the production server:
git pull origin master
docker compose build --no-cache
docker compose up -d
```

Docker maps port 3033 → Next.js on 3000. Worker runs as a separate service in the same compose file.

## Sprint Status

| Sprint | Feature | Status |
|--------|---------|--------|
| 1 | Dashboard, portfolio positions | ✅ Done |
| 2 | Trading chart (TradingView-style) + portfolio overlay | ✅ Done |
| 3 | Strategies + setup builder | ✅ Done |
| 4 | Signal engine (BullMQ worker) | ✅ Done |
| 5 | Setup comparison panel + trading page overhaul | ✅ Done |

## Architecture

### Core Domain

Warren Portfolio is a multi-asset investment tracker for Argentine markets. It tracks three asset classes:
- **CEDEARs** (Argentine DR on foreign stocks) — have a `ratio` converting shares ↔ CEDEAR units
- **ONs** (Obligaciones Negociables) — corporate bonds; tickers **must end with `D`** (Dollar-MEP only)
- **Cash** — USD balance derived from deposits, withdrawals, coupons, dividends

### The Portfolio Engine (`src/lib/portfolio-engine.ts`)

The heart of the app. Implements running weighted-average cost:
- `COMPRA`: `new_avg = (cost_basis + qty × price + commission) / (old_qty + qty)`
- `VENTA`: avg_cost unchanged; only reduces qty and cost_basis proportionally
- When `qty → 0`: position closes, cost basis resets to zero

This sequential algorithm cannot be replicated in SQL or spreadsheet formulas — it requires processing transactions chronologically.

### ON Engine (`src/lib/on-engine.ts`)

Mirrors the portfolio engine for ON positions. Delegates everything to the atomic RPC `process_transaction_atomic` — a single Supabase PostgreSQL function that handles insert + position update + cash movement in one DB transaction.

### Cash Engine (`src/lib/cash-engine.ts`)

Manages `cash_balance` table. Every COMPRA/VENTA/CUPON/DIVIDENDO triggers a `cash_movements` record. `rebuildCashBalance` replays all movements from scratch.

### Concurrency (`src/lib/concurrency.ts`)

Optimistic locking via `version` column on `positions`, `on_positions`, and `cash_balance`. `updateWithOptimisticLock()` reads → calculates → updates WHERE version matches, retrying up to 3× on conflict.

### Caching (`src/lib/cache.ts`, `src/lib/redis.ts`)

Redis with `warren:` key prefix. Gracefully degrades to direct fetch if Redis is unavailable. After any write that mutates data, call `invalidateCache(pattern)` or `invalidateUserCache(userId)` — failing to do this causes stale dashboard data (10-minute lag).

`CacheTTL` constants: `CASH_BALANCE=30s`, `PORTFOLIO_SUMMARY=60s`, `TICKER_PRICES=300s`.

### Background Worker (`src/lib/price-worker.ts`, `src/lib/queue.ts`)

BullMQ queues over Redis:
- `price-updates` — fetches Yahoo Finance prices on a repeating schedule
- `import-transactions` — processes bulk Excel imports asynchronously

Run the worker separately: `npm run worker` (or the `worker` Docker service).

**CRITICAL**: Workers run via `tsx` outside Next.js and **cannot use `@/` path aliases**. Use relative imports (`../../lib/foo`) in `price-worker.ts` and `signals-worker.ts`.

### Auth Pattern for API Routes

Always use `requireUser()` + `isAuthFailure()` from `@/lib/api-auth` — never call `supabase.auth.getUser()` directly (causes 429 on Supabase free tier):

```ts
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  const authResult = await requireUser()           // no args
  if (isAuthFailure(authResult)) return authResult.error  // .error is the NextResponse
  const { user } = authResult
  // ...
}
```

### Supabase Clients (`src/lib/supabase-server.ts`)

Three distinct clients — use the right one:
| Function | Use in |
|---|---|
| `createSupabaseServerClient(req, res)` | `src/middleware.ts` only |
| `createServerClientInstance()` | API route handlers, server components |
| `createServiceClient()` | Background jobs / privileged ops (bypasses RLS) |

### Auth (`src/middleware.ts`)

Supabase SSR with HTTP-only cookies. Protected routes: `/dashboard`, `/history`, `/cashflow`, `/statistics`. Token auto-refresh happens inside `getSession()` calls — no manual refresh needed.

Cookie format (for testing/scripts): `encodeURIComponent(JSON.stringify(session))` — NOT base64. Using base64 crashes middleware with `TypeError: Cannot create property 'user' on string`.

### Trading Page (`/trading`)

Full-screen TradingView-style chart. **Has its own isolated layout** (`src/app/trading/layout.tsx`) — does NOT include the app Sidebar. This is intentional.

Layout chain:
```
src/app/layout.tsx
  └── src/app/trading/layout.tsx  (full-screen, bg-tv-bg)
        └── src/app/trading/page.tsx
              ├── Header           (brand + CRYPTO/STOCKS toggle + chart controls + compact nav)
              ├── LeftSidebar      (drawing tools)
              ├── PriceChart       (main chart canvas)
              ├── RightSidebar     (P&L sidebar + Watchlist tabs)
              └── BottomPanel      (symbol stats)
```

**DataSource system** (`src/lib/store/chart-store.ts`, persisted in localStorage):
- `"binance"` — fetches live data from `api.binance.com` via WebSocket; SymbolSelector shows Binance pairs
- `"yahoo"` — fetches EOD data from `/api/klines`; SymbolSelector shows portfolio tickers + free-text Enter

**To view a stock/CEDEAR chart**: click any position in the P&L sidebar → automatically switches to `yahoo` mode and loads that ticker.

**BottomPanel**: in `yahoo` mode shows "Yahoo Finance · EOD" indicator. In `binance` mode shows live 24h stats.

**Setup color system** (`src/lib/setup-color.ts`): canonical `getSetupColor(setupId)` shared between PriceChart and performance page. Hash: `(hash * 31 + charCode) | 0` mod 5 colors. Always import from here — never reimplement.

### Sprint 5 — Setup Comparison Panel

Performance panel at `/strategies/[id]/performance`:
- Comparison table: win rate, avg return, avg duration, signal count per setup
- Best setup highlighted (highest win rate)
- Signal feed with filters (period, ticker, setup, type)
- Paper trades tab

API routes:
- `GET /api/strategies/[id]/performance` — aggregated metrics with per-metric weighted avg (null rows excluded from denominator)
- `GET /api/strategies/[id]/signals` — filtered signals
- `GET /api/strategies/[id]/paper-trades` — filtered paper trades

### Database Schema

All tables have Row Level Security (RLS) + optimistic locking (`version` column):

| Table | Purpose |
|---|---|
| `transactions` | Every op: COMPRA / VENTA / DIVIDENDO |
| `positions` | Open stock/CEDEAR positions |
| `on_positions` | Open ON positions |
| `closed_trades` | Realized P&L for stocks/CEDEARs |
| `on_closed_trades` | Realized P&L for ONs |
| `cash_balance` | Single-row cash balance per user |
| `cash_movements` | DEPOSITO / RETIRO / CUPON / DIVIDENDO history |
| `portfolio_snapshots` | Daily snapshots for the evolution chart |
| `strategies` | User-defined investment strategies |
| `setups` | Signal setups per strategy |
| `signals` | Generated signals from setup engine |
| `paper_trades` | Simulated trades from signals |

Migrations live in `supabase/migrations/` — the most important is `014_atomic_transaction_rpc.sql` which defines `process_transaction_atomic`.

### Key Gotchas

- **CEDEAR ratio**: positions store quantity in raw shares; UI must multiply by ratio to show CEDEAR units
- **ON ticker validation**: all ON tickers are uppercase and must end with `D` — enforced in `processONTransaction`
- **Cache invalidation is mandatory**: every POST/PATCH/DELETE API route must invalidate the relevant Redis keys or the dashboard will show stale data
- **`createServiceClient()` bypasses RLS**: only use it in server-side code that already validates `user_id`
- **Atomic RPC**: new transaction flows go through `process_transaction_atomic` — do not bypass it with separate inserts
- **Worker path aliases**: workers use relative imports, not `@/` — `tsx` runs outside Next.js build context
- **Auth in API routes**: use `requireUser()` from `api-auth.ts`, never `getUser()` directly — causes 429 on Supabase free tier
- **Weighted avg denominators**: when computing averages across setups, use per-metric denominators (exclude null rows per metric) — a global denominator dilutes metrics where some setups have no data
- **`getSetupColor` is canonical**: always import from `src/lib/setup-color.ts` — two implementations with different hashes cause color mismatches between chart and table
