# Warren Portfolio

An app to track an investment portfolio: stocks, CEDEARs, corporate bonds and cash.

I built it for myself because I was keeping everything in Google Sheets and it had
become uncomfortable to use, plus I couldn't handle corporate bonds properly. I use
it every day to check how my positions are doing.

Most portfolio trackers aren't built for the Argentine market. This one converts
CEDEARs to their underlying shares using the conversion ratio and the day's dollar
rate, which is the part none of them solve.

---

## The Hard Part

Not showing the numbers — making sure they're right.

When you buy the same asset several times at different prices, and later sell part
of the position, working out what it actually cost you isn't a direct calculation.
You have to walk the transactions in order and see how the average evolves: the
average after the third buy depends on how it ended up after the second. That's
sequential by nature, which is why it lives in a dedicated module and not in a SQL
query.

In an app like this, data integrity is the whole point. The user has to be able to
trust that the money the system reports is the money they have.

---

## Prices

A background worker refreshes quotes every few minutes and stores them in Redis.

I chose that over fetching in real time because the Yahoo API is unstable and has a
low rate limit. This way I'm in control: if Yahoo fails, I show the user the last
price I have — even if it's stale — instead of breaking the screen.

---

## What It Does

- **Positions**: buys and sells with running weighted average cost, realized P&L on
  closed trades.
- **Asset classes**: stocks, CEDEARs (with ratio conversion), corporate bonds and a
  cash balance derived from deposits, withdrawals, coupons and dividends.
- **Charts**: interactive price charts with drawings (trendlines, channels,
  Fibonacci) persisted per user.
- **Alerts**: configurable price triggers delivered over Telegram and email.
- **Bulk import**: spreadsheet import processed asynchronously through a queue.

---

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind
- **Database**: PostgreSQL via Supabase, with Row-Level Security
- **Cache & Queues**: Redis, BullMQ
- **Charts**: Lightweight Charts, Recharts
- **Testing**: Vitest
- **Infra**: Docker Compose (app + worker), GitHub Actions

---

## Notes on Concurrency

Positions and cash balance use optimistic locking through a `version` column: a row
only updates if nobody changed it while the calculation was running, and retries with
fresh data if it lost the race. Transactions that touch several tables at once go
through atomic PostgreSQL functions so there's no partial state.

---

## Running Locally

### Prerequisites
- Node.js 20+
- Redis
- A Supabase project (cloud or local CLI)

### 1. Clone and install
```bash
git clone https://github.com/Stefanopellegrinoo/warren-portfolio.git
cd warren-portfolio
npm install
```

### 2. Configure environment
```bash
cp .env.local.example .env.local
```

Fill in your Supabase URL and keys, and your Redis connection string.

### 3. Apply migrations

Run the SQL files in `supabase/migrations/` in order, through the Supabase SQL editor
or the CLI.

### 4. Run

```bash
npm run dev     # app
npm run worker  # background worker (needs Redis)
```

---

## Testing

```bash
npm run test
npm run type-check
```

---

## Deployment

```bash
docker compose up -d --build
```

The app exposes `GET /api/health` for liveness checks (probes Redis and Supabase).

---

## License

MIT