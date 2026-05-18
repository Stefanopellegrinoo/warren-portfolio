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

### Supabase Clients (`src/lib/supabase-server.ts`)

Three distinct clients — use the right one:
| Function | Use in |
|---|---|
| `createSupabaseServerClient(req, res)` | `src/middleware.ts` only |
| `createServerClientInstance()` | API route handlers, server components |
| `createServiceClient()` | Background jobs / privileged ops (bypasses RLS) |

### Auth (`src/middleware.ts`)

Supabase SSR with HTTP-only cookies. Protected routes: `/dashboard`, `/history`, `/cashflow`, `/statistics`. Token auto-refresh happens inside `getSession()` calls — no manual refresh needed.

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

Migrations live in `supabase/migrations/` — the most important is `014_atomic_transaction_rpc.sql` which defines `process_transaction_atomic`.

### Key Gotchas

- **CEDEAR ratio**: positions store quantity in raw shares; UI must multiply by ratio to show CEDEAR units
- **ON ticker validation**: all ON tickers are uppercase and must end with `D` — enforced in `processONTransaction`
- **Cache invalidation is mandatory**: every POST/PATCH/DELETE API route must invalidate the relevant Redis keys or the dashboard will show stale data
- **`createServiceClient()` bypasses RLS**: only use it in server-side code that already validates `user_id`
- **Atomic RPC**: new transaction flows go through `process_transaction_atomic` — do not bypass it with separate inserts
