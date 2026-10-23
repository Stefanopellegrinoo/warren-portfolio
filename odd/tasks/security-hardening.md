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
- S11 (xlsx): `xlsx@0.18.5`, which has prototype-pollution and ReDoS advisories, is replaced or upgraded.

## Tasks

- [x] T1 · S1 · inline · `requireUser` verifies with `auth.getUser()` · Risk item 2 · `2609296` (RED 2/3 → GREEN 3/3)
- [x] T2 · S2 · inline · import status owner check + 5 MB upload cap · `d755548` (RED 3/4 → GREEN 4/4)
- [x] T3 · S3 · inline · `images.unoptimized: true` · `897a3b4` (no test: one config line; guard read in `next/dist/server/next-server.js:166`)
- [x] T4 · S4 · inline · migration 048 function grants · `9e65eea` (RED ENOENT → GREEN 7/7). Written, NOT applied: needs the user's OK
- [ ] T5 · S5 · inline · rate limit + input caps, plus review advisories L4 (a) `content-length` pre-check and (b) 503 on Auth outage
- [ ] T6 · S6 · inline · generic 500s
- [ ] T7 · S7 · inline · same-origin redirect
- [ ] T8 · S8 · inline · security headers (needs browser check)
- [ ] T9 · S9 · inline · compose port + CI permissions (needs a server-side check by the user)
- [ ] T10 · S10 · pending decision · Next.js upgrade
- [ ] T11 · S11 · pending · xlsx

Owner actions (outside the code): rotate the Redis password found in public git history (`36a1bd3`, `6e45266`, `b8c2828`) if that Redis still exists. Turn on leaked-password protection in Supabase Auth. Decide whether signups stay open (7 users today).

## Log

- L1 (2026-10-23, user): "quiero proteger la seguridad de toda la aplicación. Quiero proteger los endpoints que no van a ser llamadas a otras páginas, o sea, que me roben las APIs con todos los datos. También quiero que mejoren mucho la seguridad, la autorización y todas esas cosas. Y importante que no haya filtración de tokens, ni pueda leer base de datos, FTP RLS. Quiero mejorar la seguridad de toda la aplicación."
- L2 (2026-10-23, audit): RLS is on in all 51 public tables, and per-user tables filter on `auth.uid() = user_id`. No route runs a service-role query on an id from the URL or body, so the S1 forgery is the root cause and one helper fixes it. `gh repo view` shows the repo is PUBLIC.
- L3 (2026-10-23, T1-T4): full suite 187 files / 1906 tests green, and `tsc --noEmit` is clean. A read-only `::regprocedure` query resolved all four 048 signatures on the live DB, and `service_role` has `rolbypassrls`, so the workers keep working. `src/middleware.ts` still uses `getSession()` on purpose: it only redirects page shells, and the data comes from the API, which now verifies the token. Changing it would add an Auth round-trip to every page navigation. Next: push and deploy T1-T3 and apply 048, both with the user's OK, then T5.
- L4 (2026-10-23, verification + review): the independent verifier passed S1-S4 with no blockers. It probed with the real `@supabase/ssr` 0.1.0 and auth-js: at baseline a forged cookie returned the victim user with 0 fetch calls, and on the candidate it got 401 after `GET /auth/v1/user`. It also checked that the refresh path is unchanged and applied 048 offline to `postgres:16` with `--network none`: anon can execute none of the four functions, and it re-applies without error. Native review (lenses risk + resilience, lineage `review-60882ab260d43bce`) was approved and acknowledged, authority burned. Its advisories, all non-blocking and folded into T5: (a) the 5 MB check runs after `req.formData()` has buffered the body, so a `content-length` pre-check is needed, and the JSON branch has no byte cap; (b) an Auth outage now shows up as 401 for every route instead of 503; (c) `status` 404s jobs whose data has no matching `userId`, though every producer stores it. Pre-existing: `999_test_helpers.sql` `set_auth_uid_for_test` has no REVOKE.
