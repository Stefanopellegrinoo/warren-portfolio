# Security hardening: API, auth, database grants, headers, infra

Objective: no outsider can read or change a user's data through the API or the public Supabase key, tokens never leak, and the public surface cannot be abused.
Branch: `security/hardening` (from `origin/master`). Delivery: ask-on-risk; the urgent slice (T1-T4) ships first. Test runner: vitest (`npm test`, `npm run type-check`).

## Specs

Specs S1-S11 come from the 2026-10-23 audit (two read-only audits plus live checks on Supabase project `qimjgaqidscroxrqsbtd`); the user's words are in L1.

- S1 (auth): "proteger los endpoints ... que me roben las APIs con todos los datos" → every API route trusts only a server-verified identity. `requireUser` must reject a cookie whose JWT the Auth server does not accept. Evidence: `requireUser` used `auth.getSession()`, which never verifies the JWT, so a forged `sb-<ref>-auth-token` cookie with a known user id passed. The import route then queued a service-role job, and `?replace=true` runs `replace_portfolio_atomic`, which deletes that user's transactions. The repo is public and the owner's user id is committed.
- S2 (import): a user can read only their own import job status, and an uploaded file larger than 5 MB is rejected before it is parsed.
- S3 (image optimizer): `/_next/image` is disabled (`images.unoptimized`), because Next 14.1.0 has unauthenticated RCE advisories in it (GHSA-2xp9-vwfh-vxw4, GHSA-2464-fhr4-w9xw) and the app does not use `next/image`.
- S4 (database grants): `anon` cannot execute any write function. Only the service role can execute `update_setup_performance_atomic`, `import_transactions_atomic` and `replace_portfolio_atomic`, and the first one stops being `SECURITY DEFINER`.
- S5 (abuse): public and proxy endpoints have a rate limit and input caps (tickers per `quote` call, `q` length, `limit`, upstream timeout).
- S6 (errors): 500 responses return a generic message, never `error.message`.
- S7 (redirect): `auth/callback` redirects only to a same-origin path.
- S8 (headers): CSP, frame-ancestors, nosniff, Referrer-Policy, HSTS and Permissions-Policy are set, `X-Powered-By` is removed, and the PWA does not cache `/api/*`.
- S9 (infra): the app port is bound to 127.0.0.1, and the CI token has least privilege.
- S10 (framework): Next.js is moved to a patched release. This is a separate decision because Next 15 means React 19.
- S12 (market data, direct DB): "Lo que no quiero es que otra persona me robe los endpoints con los datos del mercado" → nobody, anonymous or signed in, can read the market/reference tables directly through Supabase with the public key. Only the server reads them (service role), behind `requireUser` and the rate limits. The app stays open to anyone: "si quiero que la app la use cualquiera". Evidence 2026-10-23: with the anon key from the public JS bundle and no login, PostgREST returned on_terms 260 rows, on_flow_history 1531, on_price_history 2288, on_cashflows 1519, on_yield_checks 721, activos 329 and cedears 325. transactions returned 0 (RLS).
- S13 (market data, API): every endpoint that serves market data has a per-user (or per-IP when public) limit, and no endpoint hands the whole curated dataset to an anonymous caller.
- S11 (xlsx): `xlsx@0.18.5`, which has prototype-pollution and ReDoS advisories, is replaced or upgraded.

## Tasks

- [x] T1 · S1 · inline · `requireUser` verifies with `auth.getUser()` · Risk item 2 · `2609296` (RED 2/3 → GREEN 3/3)
- [x] T2 · S2 · inline · import status owner check + 5 MB upload cap · `d755548` (RED 3/4 → GREEN 4/4)
- [x] T3 · S3 · inline · `images.unoptimized: true` · `897a3b4` (no test: one config line; guard read in `next/dist/server/next-server.js:166`)
- [x] T4 · S4 · inline · migration 048 function grants · `9e65eea` (RED ENOENT → GREEN 7/7). APPLIED to prod 2026-10-23 (L5)
- [x] T5 · S5 · delegated (writer trigger (a): parallel with T6, disjoint surfaces) · rate limit + input caps, plus review advisories L4 (a) `content-length` pre-check and (b) 503 on Auth outage · `cd274c1` (RED→GREEN per rule, 11 files / 73 tests) · Risk item 3: `requireUser` and `fetchAllData912Quotes` are shared
- [x] T6 · S6 · delegated (writer trigger (a): parallel with T5) · generic 500s · `33d3e71` (RED 6+1 → GREEN; 18 files / 155 tests) · Risk item 3: the 500 body changes on about 25 routes; domain messages are kept
- [x] T7 · S7 · inline · same-origin redirect + no OAuth code in logs (L1 "que no haya filtración de tokens") · `ec7c841` (RED 5/10 → GREEN 10/10)
- [x] T8 · S8 · inline · security headers · `f4131e1` (RED → GREEN 4/4; browser check L7)
- [x] T9 · S9 · inline · compose port + CI permissions + actions pinned to SHAs · `fecea5e` (no unit test: config; `docker compose config` OK) · Risk item 5: check the site after the deploy
- [x] T10a · S10 · inline · Next 14.1.0 → 14.2.35. This is the last 14.x and still uses React 18. It fixes CVE-2025-29927 (middleware bypass), the cache-poisoning and Server Actions SSRF advisories, and several DoS advisories. Risk item 5 · `6f78c1f` (suite 195/1957 green, tsc clean, prod build OK)
- [x] T12 · S12 · delegated (writer trigger (b): parent context backstop) · server reads market tables with the service role; migration 049 revokes anon/authenticated SELECT · Risk item 2 · `73ccc9b` (049, offline-validated, NOT applied) + `e9cdf2e` (code; fx + CEDEAR-edit routes by the parent; RED 11/12 → GREEN)
- [x] T13 · S13 · delegated after T12 (writer trigger (b); its route tests overlap T12) · per-user limits on the remaining market endpoints; anonymous catalog routes reviewed · `3ee5343` (RED 15/49 → GREEN 49/49) · Risk item 3: activos/cedears/ons-search now return 401 to anonymous callers, as requested
- [ ] T10b · S10 · pending user decision · Next 15.5.x: the remaining advisories are only fixed there, and it needs React 19.
- [x] T11 · S11 · inline · `xlsx` 0.18.5 → SheetJS 0.20.3 from the official CDN tarball. npm has no fixed release. The only user is `transactions/import/route.ts:47`. Risk item 5 · `c827c6e` (round-trip parse with `cellDates` OK; the lockfile keeps sha512 integrity)

Owner actions (outside the code): rotate the Redis password found in public git history (`36a1bd3`, `6e45266`, `b8c2828`) if that Redis still exists. Turn on leaked-password protection in Supabase Auth. Decide whether signups stay open (7 users today).

## Log

- L1 (2026-10-23, user): "quiero proteger la seguridad de toda la aplicación. Quiero proteger los endpoints que no van a ser llamadas a otras páginas, o sea, que me roben las APIs con todos los datos. También quiero que mejoren mucho la seguridad, la autorización y todas esas cosas. Y importante que no haya filtración de tokens, ni pueda leer base de datos, FTP RLS. Quiero mejorar la seguridad de toda la aplicación."
- L2 (2026-10-23, audit): RLS is on in all 51 public tables, and per-user tables filter on `auth.uid() = user_id`. No route runs a service-role query on an id from the URL or body, so the S1 forgery is the root cause and one helper fixes it. `gh repo view` shows the repo is PUBLIC.
- L3 (2026-10-23, T1-T4): full suite 187 files / 1906 tests green, and `tsc --noEmit` is clean. A read-only `::regprocedure` query resolved all four 048 signatures on the live DB, and `service_role` has `rolbypassrls`, so the workers keep working. `src/middleware.ts` still uses `getSession()` on purpose: it only redirects page shells, and the data comes from the API, which now verifies the token. Changing it would add an Auth round-trip to every page navigation. Next: push and deploy T1-T3 and apply 048, both with the user's OK, then T5.
- L4 (2026-10-23, verification + review): the independent verifier passed S1-S4 with no blockers. It probed with the real `@supabase/ssr` 0.1.0 and auth-js: at baseline a forged cookie returned the victim user with 0 fetch calls, and on the candidate it got 401 after `GET /auth/v1/user`. It also checked that the refresh path is unchanged and applied 048 offline to `postgres:16` with `--network none`: anon can execute none of the four functions, and it re-applies without error. Native review (lenses risk + resilience, lineage `review-60882ab260d43bce`) was approved and acknowledged, authority burned. Its advisories, all non-blocking and folded into T5: (a) the 5 MB check runs after `req.formData()` has buffered the body, so a `content-length` pre-check is needed, and the JSON branch has no byte cap; (b) an Auth outage now shows up as 401 for every route instead of 503; (c) `status` 404s jobs whose data has no matching `userId`, though every producer stores it. Pre-existing: `999_test_helpers.sql` `set_auth_uid_for_test` has no REVOKE.
- L5 (2026-10-23, user): "Si" (OK to push, open the PR to master, merge it, and apply 048).
  - PR #21 is open, and branch CI `test` passed.
  - The merge was denied by the Claude Code permission classifier ("Production Deploy"), so the user must merge PR #21 themselves.
  - Before deploy, a live probe on prod with a forged cookie for a non-existent user id: `GET /api/quote?tickers=AAPL` returned 200, without a cookie 401, and `/_next/image` returned 200.
  - 048 was applied with `apply_migration` (statements without BEGIN/COMMIT, since the tool is already transactional) and checked with `has_function_privilege`: anon executes none of the four; `authenticated` executes only `process_transaction_atomic`; `service_role` executes all four; `update_setup_performance_atomic` shows `prosecdef=f` and `search_path=public, pg_temp`.
  - The two SECURITY DEFINER advisor lints are gone. These remain: mutable search_path on five INVOKER functions (low) and leaked-password protection (owner action).
- L6 (2026-10-23, user): "Ahora no lo puedo hacer. Segui con todo esto" (PR #21 stays unmerged for now; continue T5 onward).
  - Delivery decision: PR #21 stays the reviewed urgent slice. T5+ go on `security/hardening-2`, stacked on `security/hardening`, and its PR is retargeted to `master` once #21 merges. This follows the stacked-to-main pattern without asking, since the user is away. It is recorded here so it can be changed.
  - Evidence for T5 and T9: the largest watchlist has 6 items. (continued in L7) The `warren-cloudflared` tunnel runs with `--network host` and targets `http://localhost:3033`, so binding the app to 127.0.0.1 keeps the tunnel working. The Oracle Security List does not open 3033 (memory `migracion-oracle-y-ci`), so the bind is defense in depth.
- L7 (2026-10-23, T5-T11 evidence):
  - Seam check after both writers: 195 files / 1957 tests pass, `tsc` is clean, and lint shows 0 errors (38 baselined warnings).
  - Both writer diffs were checked against their surfaces; nothing fell outside.
  - The production build (Next 14.2.35) was built in a scratch worktree, because the user's own dev server holds `.next` on :3003, and served on :3077.
  - `curl` on :3077:
    - All six headers are present and `X-Powered-By` is gone.
    - `/_next/image` returns 404.
    - The forged cookie on `/api/quote` returns 401.
  - The generated `sw.js` has no `apis` cache.
  - Chromium headless, forged cookie, 8 pages (login, dashboard, trading, ons, statistics, history, cashflow, strategies):
    - 0 `securitypolicyviolation` events and 0 CSP console errors.
    - `/trading` reaches `api.binance.com` and `wss://stream.binance.com:9443`.
    - A login with a fake email sends `POST /auth/v1/token` to Supabase and gets 400 with no violation.
  - Not exercised: charts filled with real data, because there was no valid session. Canvas drawing needs no CSP allowance, and recharts inline styles are covered by `style-src 'unsafe-inline'`.
  - The lockfile churn came from CRLF: `package-lock.json` is CRLF, and npm 11 rewrites it as LF. CRLF was restored, so each dependency diff shows only its real lines.
  - T6 judgment calls left as is:
    - klines PROVIDER_UNAVAILABLE 500s are now generic. This includes the deliberate "No historical CCL rate…" message, which is still logged.
    - Domain P0001 messages keep their status 500; moving them to 4xx is a separate decision.
    - The engines' import-lock and ON-suffix guards are matched by text (`ENGINE_GUARDS`); a typed error would be the follow-up.
- L8 (2026-10-23, independent verifier on T5-T11, baseline `security/hardening`):
  - S5, S8, S9, S10a and S11 PASS; S1 has not regressed.
  - Blocker B1, S7 regression from `ec7c841`: `next=/..//evil.com` (also `/.//`, `/a/..//`, `/%2e%2e//`) produced the path `//evil.com`, which the route resolves again as a host and redirects to evil.com.
  - Blocker B2, S6, pre-existing: `ticker/search` answered provider failures with their raw text.
  - Correction batch `1786dac`:
    - The callback now checks the final value against the origin.
    - `ticker/search` follows the klines pattern through `serverError`.
    - Advisory 1 is folded in: a hung Redis hung every authenticated route through the limiter, which now gives up after 250 ms and allows the request.
    - RED 6 → GREEN; the suite is 195 files / 1962 tests and `tsc` is clean.
  - One recheck, limited to these items, is pending.
  - Remaining advisories, not fixed:
    - (2) after a Redis outage longer than ~1.2 s, the existing `getRedis` client stops retrying, so limits stay off until the process restarts;
    - (3) a watchlist with more than 50 Yahoo tickers would get a 400 (the largest today has 6);
    - (4) `quote` checks the cap before auth, so it returns 400 instead of 401 (cosmetic);
    - (5) pre-existing: next-pwa's `cross-origin` rule caches Supabase `GET /auth/v1/user` JSON for up to 1 h on the device; this is user metadata, not a token;
    - (6) pre-existing: the Excel `toISOString()` day shift east of UTC.
- L9 (2026-10-23, recheck + native review):
  - The single recheck of `1786dac` passed all three items.
    - B1: every dot-segment payload now lands on `/dashboard`, with the real callback GET.
    - B2: `ticker/search` 500s are generic, while 404 and 429 keep their messages.
    - Hang: with Redis paused, `rateLimit` answers in 251 ms and `requireUser` in 273 ms. After unpausing, counting resumes.
  - Native review (lineage `review-2f570a5fb2aec185`, lenses risk, resilience and readability, the user granted consent) was approved and acknowledged; authority burned.
  - Two of its advisories were fixed in `68cba31`: the misplaced JSDoc, and `requireUser` not saying that it rate-limits.
  - Advisories left as notes:
    - x-forwarded-for fallback: trusted only behind the tunnel, which S9 enforces.
    - `ons/search` has its own 500 body instead of `serverError`.
    - Domain errors kept by `serverError` are not logged.
    - The `quote` per-user limit of 60/min against polling. Today: one `useQuote` at 15 s plus the watchlist at 30 s.
    - The rate-limit hang adds up to 250 ms of latency.
    - Builds now depend on `cdn.sheetjs.com` being reachable.
  - From the recheck:
    - Calls queued during a hang still run once Redis returns; the window TTL bounds the effect.
    - The first connection on a cold start may exceed 250 ms and let one request through.
- L10 (2026-10-23, deploy of #21):
  - The user merged PR #21 (`! gh pr merge 21 --merge`), and CI master test, image and deploy all succeeded.
  - Live on https://warren.fratellipastas.com with a forged cookie for a non-existent user:
    - `/api/quote` 401 (it was 200 before the deploy);
    - `/api/positions` 401;
    - `/api/transactions/import/status` 401.
  - Also live: no cookie 401, `/_next/image` 404 (it was 200), `/auth/login` 200, `/api/health` ok (redis, supabase and worker fresh).
  - PR #22 was retargeted to `master` and is mergeable, with 13 commits.
  - Not verified by me: a real logged-in session on prod, since I have no credentials. The user should open the app once; the independent verifier covered valid sessions with the real libraries.
- L11 (2026-10-23, deploy of #22):
  - The user merged PR #22, and CI master test, image and deploy all succeeded.
  - The site loads through the tunnel with the loopback-bound port: health 200, login 200, `/` and `/dashboard` 307 to login.
  - Live headers: CSP, X-Frame-Options, nosniff, Referrer-Policy, HSTS and Permissions-Policy, and no X-Powered-By.
  - A forged cookie gets 401, and `/_next/image` 404.
  - Per-IP limit on `/api/activos`: exactly 60×200, then 429 with `Retry-After: 60`.
    - A client-set `cf-connecting-ip` is rejected by Cloudflare with 403.
    - A spoofed `x-forwarded-for` still gets 429, so the key is the real client IP from Cloudflare, not `unknown`.
  - Chromium on the live `/auth/login`: 0 CSP violations and no page errors.
  - Open: T10b (Next 15, user decision) and the owner actions in the header.
- L12 (2026-10-23, user): "Anda todo bien." The user logged in with a real account on prod after #21 and #22, which closes the one check left open in L10.
- L13 (2026-10-23, user): "Pero si quiero que la app la use cualquiera. Lo que no quiero es que otra persona me robe los endpoints con los datos del mercado"
- L14 (2026-10-23, user): "Ok" (to layers 1 and 2: close direct DB reads of market tables, and per-user limits on market endpoints). The migration and the deploy each need a separate OK. Layer 3 (email confirmation + Turnstile CAPTCHA) needs the user's Cloudflare setup and is deferred.
- L15 (2026-10-23, T12 map):
  - A read-only explorer mapped 14 user/anon read paths to the 13 market tables, fixed by 10 switch points (`on-catalog`, `on-schedules` = the ledger-core choke point, `on-payments`, `currency-views` fx/cedears, `ledger-now` loadLastCloses, `derived-series`, `fx-rates`, `trade-record`, `ticker-catalog`, plus the 3 public routes).
  - There are no views, and no RPC called by a non-service client reads these tables.
  - Pre-existing bug: `derived-series` backfills upsert `on_price_history` (rava) and `on_flow_history` (bonistas) with the user client, which RLS denies.
  - Fallout check: switching `loadSchedules` alone broke 14 tests in 10 files, because fixtures inject market rows through the user client.
  - The `pg_stat_statements` baseline shows `authenticated` and `anon` reading all 13 tables. After the code deploy and before 049, their deltas must be 0.
- L16 (2026-10-23, T12-T13): the suite is 197 files / 1994 tests, `tsc` is clean and lint shows 0 errors. The independent verifier is running, with focus on cross-tenant safety for every `createServiceClient()` use.
