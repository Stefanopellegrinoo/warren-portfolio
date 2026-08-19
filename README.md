# Warren Portfolio

[![CI](https://github.com/Stefanopellegrinoo/warren-portfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/Stefanopellegrinoo/warren-portfolio/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14.x_App_Router-black.svg?logo=next.js)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_%2B_RLS-3ECF8E.svg?logo=supabase)](https://supabase.com/)
[![Redis](https://img.shields.io/badge/Redis-BullMQ_Queues-DC382D.svg?logo=redis)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Multi--stage_Compose-2496ED.svg?logo=docker)](https://www.docker.com/)
[![Tests](https://img.shields.io/badge/Vitest-900%2B_tests_passing-6E9F18.svg?logo=vitest)](https://vitest.dev/)

Warren Portfolio is a full-stack investment portfolio tracking and analytics platform tailored for multi-asset management across **Stocks, CEDEARs, Corporate Bonds (ONs), and Cash (USD/ARS)**.

Built with a focus on mathematical precision, data integrity, and real-time financial tracking, the platform features a financial engine implementing Moving Weighted Average Cost (MAC), Time-Weighted Returns (TWR), automated daily portfolio valuation snapshots, optimistic locking, and background distributed queues.

---

## Architecture

```
                                  ┌─────────────────────────────────────────┐
                                  │             Client Browser              │
                                  │   (Next.js 14 App Router, Tailwind UI)   │
                                  └────────────────────┬────────────────────┘
                                                       │ HTTPS / HTTP-Only Cookies
                                                       ▼
                                  ┌─────────────────────────────────────────┐
                                  │           Next.js Application           │
                                  │          Server & API Routes            │
                                  └───────────┬─────────────────┬───────────┘
                                              │                 │
                         Database Queries &   │                 │ Enqueue Jobs &
                         Auth Validation      │                 │ Read Summary Cache
                                              ▼                 ▼
             ┌───────────────────────────────────┐   ┌─────────────────────────────┐
             │       Supabase (PostgreSQL)       │   │        Redis Cluster        │
             │   - Row Level Security (RLS)      │   │   - BullMQ Queue Manager    │
             │   - Atomic Stored Procedures/RPC  │   │   - Summary Cache / CAS Lua │
             │   - Optimistic Locking (Version)  │   │   - Rate Limiting           │
             └─────────────────▲─────────────────┘   └──────────────┬──────────────┘
                               │                                    │
                               │ Write Snapshots &                  │ Dequeue Jobs
                               │ Updated Prices                     │
                               │                                    ▼
                               │                     ┌─────────────────────────────┐
                               └─────────────────────┤    BullMQ Worker Engine     │
                                                     │   - Scheduled Price Sync    │
                                                     │   - Nightly Snapshot Jobs   │
                                                     │   - Batch Excel Processor   │
                                                     │   - Signal & Price Alerts   │
                                                     └──────────────┬──────────────┘
                                                                    │
                                            External Integrations   ├─► Yahoo Finance (Live Stocks/CEDEARs)
                                                                    ├─► IOL API / Data912 (Corporate Bonds)
                                                                    ├─► Telegram Bot API (Alerts)
                                                                    └─► Resend API (Email Notifications)
```

---

## Technical Highlights

### 1. Chronological Moving Weighted Average Cost (MAC) Engine
Financial transactions are processed sequentially to prevent cost-basis distortion. The core engine (`src/lib/portfolio-engine.ts`) calculates moving weighted averages on every buy/sell:
* **Position Accumulation**: Average cost recalculates on each buy step: `avg_cost = (prev_invested + buy_amount) / new_quantity`.
* **Proportional Realized P&L**: On sell operations, cost basis reduces proportionally without altering the unit cost basis.
* **Clean Position Teardown**: When a position reaches quantity zero, all accumulators reset completely, archiving realized gains into `closed_trades`.

### 2. Time-Weighted Returns (TWR) & Max Drawdown
* **External Cash Flow Neutrality**: Portfolio performance is isolated from capital additions/withdrawals using Time-Weighted Return sub-period geometric linking:
  $$TWR = \prod_{i=1}^{n} (1 + R_i) - 1$$
* **Nightly Snapshot Precision**: Portfolio snapshots are recorded at market close (23:00 ART via `argentinaDate()`). Valuations fall back to weighted average cost if third-party providers experience downtime, preventing artificial drawdown spikes.

### 3. Database Integrity & Atomic Stored Procedures (RPC)
* **Zero Partial State Mutations**: Multi-row batch imports and portfolio replacements execute within atomic PostgreSQL stored procedures (`process_transaction_atomic`, `import_transactions_atomic`).
* **Optimistic Locking**: Balance and position modifications use optimistic concurrency control via monotonic `version` tracking to eliminate race conditions under concurrent workloads.
* **Row Level Security (RLS)**: Every database table enforces PostgreSQL RLS policies keyed to authenticated Supabase user sessions.

### 4. Distributed Asynchronous Worker (BullMQ + Redis)
* Background processing is decoupled from the web layer via a standalone Node.js worker (`src/lib/price-worker.ts`).
* Manages recurring quote syncs, nightly portfolio valuations, high-throughput spreadsheet parsing, and signal triggers.

### 5. Interactive Charting
* Interactive chart powered by `lightweight-charts` with real-time quote feeds.
* Canvas-level user drawing persistence: Trendlines, Parallel Channels, Rays, and Fibonacci Retracements saved to PostgreSQL.
* Configurable price triggers with Telegram and Email dispatch.

---

## Tech Stack

| Domain | Technology | Description |
|---|---|---|
| **Frontend** | [Next.js 14](https://nextjs.org/) | React 18, App Router, Server/Client Components |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) & [Radix UI](https://www.radix-ui.com/) | Dark-mode financial dashboard, accessible primitives |
| **Charts** | [Lightweight Charts](https://tradingview.github.io/lightweight-charts/) & [Recharts](https://recharts.org/) | High-performance interactive candlestick & area series |
| **Language** | [TypeScript 5](https://www.typescriptlang.org/) | Strict type checking across API, DB schemas, and UI |
| **Database** | [Supabase](https://supabase.com/) / [PostgreSQL](https://www.postgresql.org/) | Multi-tenant relational schema, PL/pgSQL RPCs, RLS |
| **Queue / Cache** | [Redis](https://redis.io/) & [BullMQ](https://bullmq.io/) | Job orchestration, scheduled recurring tasks, in-memory cache |
| **Testing** | [Vitest](https://vitest.dev/) | 900+ unit and integration tests covering calculation engines |
| **DevOps** | [Docker](https://www.docker.com/) & [GitHub Actions](https://github.com/features/actions) | Multi-stage Docker containerization and automated CI/CD pipeline |

---

## Project Structure

```
warren-portfolio/
├── .github/workflows/        # Automated CI/CD (lint, type-check, tests, GHCR build)
├── public/                   # Static assets, icons, and PWA manifest
├── scripts/                  # Data migration, historical backfill, and repair utilities
├── src/
│   ├── app/                  # Next.js 14 App Router (Pages, API endpoints)
│   │   ├── api/              # REST endpoints (positions, cash, alerts, transactions)
│   │   ├── auth/             # Authentication & session callbacks
│   │   ├── cashflow/         # Cash management (deposits, withdrawals, coupons)
│   │   ├── dashboard/        # Main portfolio overview, KPI cards & asset distribution
│   │   ├── history/          # Historical closed trades & realized P&L records
│   │   ├── statistics/       # TWR, Max Drawdown & risk performance analytics
│   │   ├── strategies/       # Strategy manager & setup tracking
│   │   └── trading/          # Interactive charting & technical analysis
│   ├── components/
│   │   ├── charts/           # Financial charting wrappers
│   │   ├── trading/          # Trading layout, drawing tools & watchlist components
│   │   └── ui/               # Reusable UI primitives (dialogs, tables, modals)
│   ├── hooks/                # React custom hooks
│   ├── lib/                  # Core domain logic
│   │   ├── portfolio-engine.ts # Sequential Moving Average Cost calculation
│   │   ├── on-engine.ts      # Corporate bond cash flow and amortizations
│   │   ├── twr-series.ts     # Time-Weighted Return series computation
│   │   ├── drawdown.ts       # Peak-to-trough drawdown calculation
│   │   ├── queue.ts          # BullMQ queue definitions
│   │   ├── price-worker.ts   # Long-running background worker
│   │   ├── redis.ts          # Redis client and caching helpers
│   │   └── supabase-*.ts     # Supabase client/server connection handlers
│   ├── middleware.ts         # Edge authentication middleware
│   └── types/                # Core TypeScript interfaces & schemas
├── supabase/
│   └── migrations/           # 35+ incremental SQL migrations with full RLS
├── Dockerfile                # Production multi-stage Docker build
├── docker-compose.yml        # Multi-container orchestration (App, Worker, Redis)
└── vitest.config.ts          # Test runner configuration
```

---

## Getting Started

### Prerequisites
* **Node.js**: `v20.x` or `v22.x`
* **npm**: `v10+`
* **Redis**: Local instance or Docker container (`redis:alpine`)
* **Supabase**: Free Supabase cloud project or local Supabase CLI

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Stefanopellegrinoo/warren-portfolio.git
cd warren-portfolio
npm install
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.local.example .env.local
```

Fill in your configuration details in `.env.local`:

```env
# Supabase credentials (from Supabase Dashboard -> Project Settings -> API)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Redis connection
REDIS_URL=redis://localhost:6379

# (Optional) Market data & notification providers
# IOL_USERNAME=your_iol_user
# IOL_PASSWORD=your_iol_password
# TELEGRAM_BOT_TOKEN=your_telegram_bot_token
# TELEGRAM_CHAT_ID=your_telegram_chat_id
# RESEND_API_KEY=your_resend_key
# RESEND_FROM_EMAIL=alerts@yourdomain.com
```

### 3. Apply Database Migrations

Apply the migration scripts located in `supabase/migrations/` sequentially in your Supabase SQL Editor or using the Supabase CLI.

### 4. Run the Development Server

Start both the web application and the background worker:

```bash
# Terminal 1: Next.js Frontend & API Server
npm run dev

# Terminal 2: BullMQ Background Worker (requires Redis running)
npm run worker
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Testing

The codebase includes an automated test suite covering financial math, database triggers, API routing, and concurrency safeguards:

```bash
# Run unit & integration tests
npm run test

# Run TypeScript type verification
npm run type-check
```

---

## Deployment

The application is container-ready with a multi-stage Docker build separating the web runtime and the background worker.

```bash
# Build and run all services (App, Worker, Redis) in the background
docker compose up -d --build
```

Health monitoring is built-in:
```bash
docker compose ps
# Verify the web app status is "Up (healthy)" via GET /api/health
```

---

## License

This project is open source and available under the [MIT License](LICENSE).

