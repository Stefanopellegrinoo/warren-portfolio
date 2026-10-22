# Rediseño UI: base visual, navegación y Resumen. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el estilo viejo por la "Dirección A" aprobada en un armazón nuevo (barra lateral, menú en celular, tema, buscador), y reconstruir `/dashboard` como el Resumen del boceto aprobado.

**Architecture:**
- **Tokens:** variables CSS en `globals.css`, copiadas de `tokens.css` de la referencia y expuestas a Tailwind con nombres nuevos que no chocan con la paleta vieja.
- **Armazón:** un `AppShell` cliente reemplaza al `Sidebar` viejo en los seis `layout.tsx`.
- **Resumen:** la lógica de presentación vive en módulos puros testeados (`src/lib/resumen/*`). Los componentes de la pantalla viven en `src/components/resumen/*`.

**Tech Stack:** Next 14 App Router, React 18, Tailwind 3.3, vitest con jsdom. Los tests de componentes usan `renderToStaticMarkup`, porque el repo no tiene Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-21-rediseno-ui-design.md`. **Boceto (fuente de verdad visual):** `docs/superpowers/specs/assets/2026-10-21-resumen-mockup.html`.

## Global Constraints

- **Estilo:** valores, tamaños, radios y espaciados exactos del boceto. Copiar, no reinterpretar.
- **Prohibido en lo que se toca:**
  - `glass`, `glow-*`, `backdrop-blur`, degradés decorativos y el ruido de `body::before`.
  - Palabras resaltadas en títulos y animaciones de entrada escalonadas.
  - Etiquetas en mayúsculas monoespaciadas, salvo los encabezados de grupo (`group-h`) que trae la referencia.
- **Números:** formato argentino. `39.951,80`, `−1,69 %` y `+2.529,02`, con el signo menos U+2212 `−`.
- **Responsive:** 0 px de desplazamiento horizontal en 320, 360, 390, 600, 761, 900, 1024, 1180, 1280, 1440 y 1920 px. Objetivos táctiles de 44 px por debajo de 820 px.
- **Accesibilidad:**
  - Todo control con nombre accesible.
  - Labels asociados a su campo.
  - `:focus-visible` con anillo de 2 px de color `--ring`.
  - Ganancia y pérdida con signo además de color.
  - `prefers-reduced-motion` respetado.
- **Sin cambios de datos:** no tocar rutas `src/app/api/**`, cálculos ni base de datos.
- **Verificación con datos reales:** contra la cuenta del usuario, solo lectura. Nada de POST, DELETE ni PATCH durante las pruebas.
- **Commits:** Conventional Commits, sin atribución de IA, en la rama `feat/rediseno-ui` (crearla desde `master`).

## Review Focus

1. **Cartera vacía** (sin posiciones, sin caja, sin historia). El Resumen muestra la invitación a cargar la primera operación, sin gráfico roto ni `NaN`. Test en Task 7 (`buildHoldings([])`) y en Task 8 (`buildChart([])`).
2. **Posición sin precio** (`current_price` indefinido). La fila muestra el chip neutro "Sin precio hoy", nunca `NaN %` ni `US$ 0,00` como si valiera cero. Test en Task 7.
3. **Valores negativos y cero.**
   - `formatNumber(0, { sign: true })` da `0,00`, sin `+` ni `−`.
   - Los negativos usan `−` (U+2212), no `-`.
   
   Test en Task 2.
4. **Tema guardado inválido o `localStorage` bloqueado** (modo privado). `resolveTheme` cae en `system` sin lanzar. El script anti-parpadeo envuelve el acceso en try/catch. Test en Task 1.
5. **Historia solo con puntos estimados, o con un único punto.** El gráfico no divide por cero, y la nota aclara que hay puntos estimados. Test en Task 8.

---

### Task 1: Tokens, fuentes y tema

**Files:**
- Modify: `src/app/globals.css`, `tailwind.config.js`, `src/app/layout.tsx`
- Create: `src/lib/theme.ts`, `src/lib/__tests__/theme.test.ts`

**Interfaces:**
- Produces:
  - `type ThemePref = 'light' | 'dark' | 'system'`
  - `THEME_STORAGE_KEY = 'warren-theme'`
  - `REDESIGNED_PATHS: readonly string[] = ['/dashboard']`
  - `isRedesigned(pathname: string): boolean`
  - `parseThemePref(raw: string | null): ThemePref`
  - `resolveTheme(pref: ThemePref, pathname: string): 'light' | 'dark' | null`. Devuelve `null` cuando sigue al sistema.
  - `THEME_BOOT_SCRIPT: string`, el script inline anti-parpadeo.
  - Clases Tailwind: colores `canvas`, `sidebar`, `surface`, `surface-2`, `hover`, `line`, `line-strong`, `ink`, `ink-2`, `ink-3`, `accent`, `accent-ink`, `accent-soft`, `primary`, `primary-hover`, `on-primary`, `ring`, más `danger|warn|info|ok|neutral` con sufijos `DEFAULT`, `soft` y `dot`. Todos como `var(--…)`.
  - Fuentes: `font-sans` = Plex Sans, `font-serif` = Newsreader, `font-mono` = Plex Mono.

- [ ] **Step 1: Write the failing test** `src/lib/__tests__/theme.test.ts`

```ts
expect(parseThemePref('dark')).toBe('dark')
expect(parseThemePref('banana')).toBe('system')
expect(parseThemePref(null)).toBe('system')
expect(isRedesigned('/dashboard')).toBe(true)
expect(isRedesigned('/history')).toBe(false)
expect(resolveTheme('light', '/dashboard')).toBe('light')
expect(resolveTheme('system', '/dashboard')).toBeNull()
expect(resolveTheme('light', '/history')).toBe('dark')   // old pages force dark
expect(resolveTheme('system', '/ons/mi-cartera')).toBe('dark')
```

- [ ] **Step 2: Run** `npx vitest run src/lib/__tests__/theme.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/theme.ts`**
  - `THEME_BOOT_SCRIPT` lee `localStorage[THEME_STORAGE_KEY]` dentro de `try/catch`.
  - Con la misma regla que `resolveTheme` y `location.pathname`, pone o quita `document.documentElement.dataset.theme`.
  - Duplica la lista de rutas como literal JSON con `JSON.stringify(REDESIGNED_PATHS)`.

- [ ] **Step 4: Run the test.** Expected: PASS.

- [ ] **Step 5: Tokens y fuentes**
  - `globals.css`:
    - Agregar al principio del `@layer base` los bloques `:root`, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` y `:root[data-theme="dark"]` copiados de la referencia (`--bg … --shadow-toast`).
    - Agregar las reglas base del boceto: `body` con `background: var(--bg)`, `color: var(--ink)`, `font-feature-settings: "tnum" 1`, y `:focus-visible`.
    - Borrar el `body::before` de ruido y el `background`/`color` fijos del body.
    - Dejar `.glass`, `.kpi-card`, etc. porque las páginas viejas los usan.
  - Agregar `@media (prefers-reduced-motion: reduce)` igual que en la referencia.
  - `tailwind.config.js`: agregar los colores de arriba y `fontFamily.sans|serif|mono` sobre las variables `--font-sans`, `--font-serif` y `--font-mono`. `display` pasa a `var(--font-sans)`. No tocar `bg.*`, `amber`, `tv.*`, etc.
  - `layout.tsx`:
    - Reemplazar Syne y JetBrains_Mono por `IBM_Plex_Sans` (400/500/600, `--font-sans`), `Newsreader` (400/500, `--font-serif`) e `IBM_Plex_Mono` (400/500, `--font-mono`).
    - Agregar `<script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />` en `<head>` y `suppressHydrationWarning` en `<html>`.
    - El body pasa a `className="antialiased"`.
    - Toaster: quitar `glass`, los `bg-gradient-*` y `primary-500`. Usar `theme="system"` y clases con los tokens nuevos (`bg-surface text-ink border-line`).
    - `themeColor`: `[{ media: '(prefers-color-scheme: light)', color: '#faf9f7' }, { media: '(prefers-color-scheme: dark)', color: '#161513' }]`.

- [ ] **Step 6: Run** `npm test && npm run type-check && npm run build`. Expected: todo en verde. El build compila, pero las páginas todavía se ven viejas.

- [ ] **Step 7: Commit** `feat(ui): add warm-grey design tokens, Plex/Newsreader fonts and theme resolution`

### Task 2: Formato argentino de números

**Files:**
- Modify: `src/lib/utils.ts:8-30`, `src/lib/__tests__/utils.test.ts`, `src/app/dashboard/page.tsx:291`
- Test: `src/lib/__tests__/utils.test.ts`

**Interfaces:**
- Produces:
  - `formatNumber(value: number, opts?: { decimals?: number; sign?: boolean }): string`, con `decimals` por defecto 2.
  - `formatUSD(value: number, compact = false): string`. Misma firma de hoy, salida es-AR.
  - `formatPct(value: number | null | undefined, opts?)`. Misma firma, sigue recibiendo una fracción, salida es-AR.

- [ ] **Step 1: Write the failing tests** (reemplazan las expectativas en-US de `formatPct`)

```ts
expect(formatNumber(39951.8)).toBe('39.951,80')
expect(formatNumber(2529.02, { sign: true })).toBe('+2.529,02')
expect(formatNumber(-310.45, { sign: true })).toBe('−310,45')
expect(formatNumber(-310.45)).toBe('−310,45')
expect(formatNumber(0, { sign: true })).toBe('0,00')
expect(formatNumber(4827, { decimals: 0 })).toBe('4.827')
expect(formatUSD(39951.8)).toBe('US$ 39.951,80')
expect(formatUSD(-310.45)).toBe('−US$ 310,45')
expect(formatPct(0.1234)).toBe('+12,34 %')
expect(formatPct(-0.05)).toBe('−5,00 %')
expect(formatPct(0.55, { digits: 0, sign: false })).toBe('55 %')
expect(formatPct(0)).toBe('0,00 %')
expect(formatPct(null)).toBe('—')
```

- [ ] **Step 2: Run** `npx vitest run src/lib/__tests__/utils.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - `formatNumber` usa `Intl.NumberFormat('es-AR')` sobre `Math.abs` y antepone `−`, o `+` cuando `sign && value > 0`.
  - `formatUSD` es `'US$ ' + formatNumber(|v|)` con `−` adelante si es negativo. En modo compacto usa `Intl` es-AR compacto con el mismo prefijo.
  - `formatPct` es `formatNumber(v * 100, { decimals: digits, sign }) + ' %'`.
  - Si una salida de Intl trae espacio de no separación, normalizarlo a espacio común para que los tests sean deterministas.
  - En `dashboard/page.tsx:291` reemplazar `(x*100).toFixed(2)%` por `formatPct(x)`. El archivo se reescribe en Task 9, pero hasta entonces tiene que quedar coherente.

- [ ] **Step 4: Run** `npm test`. Expected: PASS. Si otro test en-US de otra unidad falla por el formato, actualizarlo a es-AR. Es el cambio pedido.

- [ ] **Step 5: Commit** `feat(format): switch shared number, currency and percent formatting to es-AR`

### Task 3: AppShell (barra lateral, menú en celular, tema)

**Files:**
- Create: `src/components/shell/AppShell.tsx`, `src/components/shell/nav.ts`, `src/components/shell/ThemeSwitch.tsx`, `src/components/shell/__tests__/nav.test.ts`, `src/components/shell/__tests__/AppShell.test.tsx`
- Modify: los `layout.tsx` de `dashboard`, `history`, `cashflow`, `statistics`, `strategies` y `ons`. Hoy son `<div className="flex min-h-screen"><Sidebar/><main …>` y pasan a `<AppShell>{children}</AppShell>`.
- Modify: las páginas que agregan `md:pl-56`, `pb-20` o `md:pb-0`. Hay que encontrarlas con `grep -rn "md:pl-56\|md:pl-64" src/app` y quitar solo esas clases de offset.
- Delete: `src/components/layout/Sidebar.tsx`, cuando ya nadie lo importe (después de Task 6).

**Interfaces:**
- Consumes: `resolveTheme`, `THEME_STORAGE_KEY` y `parseThemePref` (Task 1). `formatPct` (Task 2).
- Produces:
  - `NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[]`, en este orden: Resumen `/dashboard`, Gráficos `/trading`, Operaciones `/history`, Rendimiento `/statistics`, Obligaciones negociables `/ons`, Estrategias y alertas `/strategies`.
  - `PERSONAL_ITEMS`: Gastos `/cashflow`.
  - `activeHref(pathname: string): string | null`. Prefijo más largo que coincide.
  - `topHoldings(positions: { ticker: string; market_value?: number }[], total: number, n = 5): { ticker: string; weightPct: number }[]`. Ordena por valor descendente y descarta los que no tienen valor.
  - `<AppShell>{children}</AppShell>`.

- [ ] **Step 1: Write failing tests**

```ts
// nav.test.ts
expect(activeHref('/ons/carteras/abc')).toBe('/ons')
expect(activeHref('/dashboard')).toBe('/dashboard')
expect(activeHref('/auth/login')).toBeNull()
expect(topHoldings([{ ticker: 'A', market_value: 10 }, { ticker: 'B', market_value: 30 }, { ticker: 'C' }], 40, 5))
  .toEqual([{ ticker: 'B', weightPct: 75 }, { ticker: 'A', weightPct: 25 }])
expect(topHoldings([], 0)).toEqual([])
// AppShell.test.tsx: renderToStaticMarkup(<AppShell pathnameForTest="/history">x</AppShell>)
// contains 'aria-current="page"' on the Operaciones link, an "Abrir menú" button with aria-controls="sidebar",
// a radiogroup labelled "Tema", and no "glass" / "glow" class.
```

  Para poder renderizarlo en el servidor, `AppShell` acepta `pathnameForTest?: string`. Si no viene, usa `usePathname()`.

- [ ] **Step 2: Run** `npx vitest run src/components/shell`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - Marcado y clases del boceto (`.app`, `.sidebar`, `.topbar`, `.scrim`, `.nav-link`, `.t-row`, `.sb-foot`, `.seg`), escritos con Tailwind sobre los tokens. El `shell.css` de la referencia es la especificación de medidas: barra de 264 px, topbar de 56 px, panel `min(86vw, 320px)` y punto de quiebre en 820 px.
  - **Mis activos:** hace `fetch('/api/positions')` una vez y muestra `topHoldings` sobre `positions`, con su `weightPct` formateado con `formatNumber(…, { decimals: 1 })` + `' %'`. Agrega el link "Ver los N", que lleva a `/dashboard#tenencias`.
  - **Cada ticker** lleva a `/trading?symbol=TICKER`.
  - **Panel en celular:** se abre con el botón y se cierra con la X, el scrim o Escape. Al cerrarse devuelve el foco al botón y actualiza `aria-expanded`.
  - **ThemeSwitch:** guarda en `localStorage` dentro de try/catch y aplica `resolveTheme`. En rutas no rediseñadas queda deshabilitado con el texto `title`/`aria-describedby` "Esta página todavía usa el estilo anterior".
  - **Cerrar sesión:** el mismo `handleLogout` que el Sidebar viejo (`signOut({ scope: 'local' })`, `router.refresh()`, `router.push('/auth/login')`).
  - **Botón de búsqueda:** es el disparador del buscador de Task 5. En esta tarea va solo el botón, sin comportamiento, y queda oculto con `hidden` hasta Task 5. No se muestra un botón muerto.

- [ ] **Step 4: Run** `npm test && npm run type-check`. Expected: PASS.

- [ ] **Step 5: Verificación responsive del armazón**
  - Con la app corriendo (`PORT=3017 npm run dev`; leer el log para confirmar el puerto), correr el script de verificación (ver "Verificación responsive" al final) sobre `/history` y `/ons`.
  - Expected: `scrollWidth === ancho` en los 11 anchos, y el panel abre y cierra a 390 px.

- [ ] **Step 6: Commit** `feat(shell): replace sidebar with warm-grey app shell, drawer on mobile and theme switch`

### Task 4: Gráficos acepta `?symbol=` y vuelve al menú

**Files:**
- Modify: `src/app/trading/page.tsx`, `src/components/trading/layout/Header.tsx:33-38`, `src/middleware.ts:28-38`

**Interfaces:**
- Produces: `/trading?symbol=DUK` abre el gráfico en DUK.

- [ ] **Step 1: Implement**
  - En `trading/page.tsx`, leer `useSearchParams().get('symbol')`. Si viene, llamar una vez a `setSymbol(symbol.toUpperCase())`.
  - Envolver lo necesario en `<Suspense>`, como exige Next 14 con `useSearchParams`.
  - Quitar el `<Sidebar />` de celular.
  - En `Header.tsx`, el bloque de marca pasa a `<Link href="/dashboard" aria-label="Volver al Resumen">`, visible en todos los tamaños.
  - En el `matcher` del middleware, agregar `'/trading/:path*'`, porque hoy `/trading` no está protegida.

- [ ] **Step 2: Verify**
  - Abrir `/trading?symbol=DUK` en la app corriendo. El encabezado tiene que mostrar DUK.
  - Sin sesión, `/trading` tiene que redirigir a `/auth/login`.

- [ ] **Step 3: Commit** `feat(trading): open a symbol from ?symbol= and link back to the summary`

### Task 5: Buscar activo (Ctrl K)

**Files:**
- Create: `src/components/shell/AssetSearch.tsx`, `src/lib/asset-search.ts`, `src/lib/__tests__/asset-search.test.ts`
- Modify: `src/components/shell/AppShell.tsx` (mostrar el botón, montar el diálogo)

**Interfaces:**
- Consumes: `/api/activos`, que devuelve `{ ticker: string; nombre: string }[]`, y los tickers en cartera que ya trae AppShell.
- Produces: `searchAssets(query: string, held: string[], catalog: { ticker: string; nombre: string }[], limit = 8): { ticker: string; name: string; held: boolean }[]`.

- [ ] **Step 1: Write failing tests**

```ts
const cat = [{ ticker: 'DUK', nombre: 'Duke Energy' }, { ticker: 'AAPL', nombre: 'Apple' }, { ticker: 'DE', nombre: 'Deere' }]
expect(searchAssets('', ['DUK'], cat)).toEqual([{ ticker: 'DUK', name: 'Duke Energy', held: true }])
expect(searchAssets('de', [], cat).map(r => r.ticker)).toEqual(['DE', 'DUK'])   // ticker prefix before name match
expect(searchAssets('apple', [], cat)[0].ticker).toBe('AAPL')                  // name match, case-insensitive
expect(searchAssets('zzz', [], cat)).toEqual([])
expect(searchAssets('duk', ['DUK'], cat)).toHaveLength(1)                      // no duplicates
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement**
  - `searchAssets`: query vacía devuelve solo los activos en cartera. Si no, ordena así: ticker exacto, ticker que empieza con la query, nombre que contiene la query. Elimina duplicados.
  - `AssetSearch` usa `<dialog>` nativo con `showModal()`, que da foco atrapado y Escape.
    - Un `<input>` con `<label>` "Buscar activo".
    - La lista con `role="listbox"` / `role="option"` y `aria-activedescendant`. Flechas y Enter eligen.
    - Elegir hace `router.push('/trading?symbol=X')`.
    - El catálogo se pide una sola vez, al abrir por primera vez.
    - Si falla, se muestra "No se pudo cargar la lista de activos" con el botón "Reintentar".
  - Se abre con Ctrl K o Cmd K desde cualquier página del armazón, y con el botón de la barra lateral.

- [ ] **Step 4: Run** `npm test && npm run type-check`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(shell): add Ctrl K asset search that opens the chart`

### Task 6: Limpieza del Sidebar viejo

- [ ] **Step 1:** `grep -rn "components/layout/Sidebar" src` tiene que dar 0 resultados. Borrar `src/components/layout/Sidebar.tsx`.
- [ ] **Step 2: Run** `npm run lint && npm run type-check && npm test`. Expected: PASS.
- [ ] **Step 3: Commit** `refactor(shell): remove the old sidebar`

### Task 7: Datos del Resumen (módulo puro)

**Files:**
- Create: `src/lib/resumen/holdings.ts`, `src/lib/resumen/__tests__/holdings.test.ts`

**Interfaces:**
- Consumes: `Position` y `ONPosition` (`src/types/index.ts:57,203`; `day_change_pct` y `pnl_pct` son fracciones), `PortfolioSummary` (`:132`), la lista de `/api/cedears` (tickers) y `/api/activos`.
- Produces:

```ts
type HoldingKind = 'stock' | 'cedear' | 'on'
interface HoldingRow { ticker: string; name: string | null; kind: HoldingKind; quantityLabel: string;
  weightPct: number; dayChangePct: number | null; value: number | null; pnl: number | null; pnlPct: number | null; href: string }
buildHoldings(input: { positions: Position[]; onPositions: ONPosition[]; cedearTickers: string[];
  names: Record<string, string>; total: number }): HoldingRow[]   // sorted by value desc, nulls last
reviewItems(rows: HoldingRow[]): { ticker: string; name: string | null; tone: 'danger' | 'warn'; chip: string; why: string }[]
distribution(summary: PortfolioSummary): { label: string; pct: number; value: number }[]  // Acciones y CEDEARs, Caja, Obligaciones negociables
```

- [ ] **Step 1: Write failing tests**, con las posiciones reales del boceto como datos (DUK 40 a 95, valor 4827; AAL 25 CEDEARs, pnl −360, pnl_pct −0.371, etc.).
  - `buildHoldings`:
    - DUK tiene `kind 'stock'`, `quantityLabel '40 acciones'` y `href '/trading?symbol=DUK'`.
    - T, que figura en `cedearTickers`, tiene `kind 'cedear'` y `quantityLabel '33 CEDEARs'`.
    - Una ON con `quantity: 15` tiene `kind 'on'`, `quantityLabel 'VN 1.500'` y `href '/ons/mi-cartera'`.
    - Una posición sin `current_price` tiene `dayChangePct === null` y `value === null`, y queda al final.
    - `buildHoldings` con todo vacío devuelve `[]`.
    - `weightPct` de DUK con `total` 39951.8 es ≈ 12.08 (usar `toBeCloseTo`).
  - `reviewItems`:
    - Con SLB (−48,9 %), AAL (−37,1 %), T (día −6,4 %) y DUK (día −0,5 %), devuelve en este orden:
      - `{ ticker: 'SLB', tone: 'danger', chip: '−48,9 %', why: 'Pierde 489 desde la compra' }`
      - AAL
      - `{ ticker: 'T', tone: 'warn', chip: '−6,4 % hoy', why: 'La mayor caída del día en tu cartera' }`
    - Si la mayor caída del día es −2 %, no aparece.
    - Una posición que ya figura por su pérdida acumulada no se repite por la caída del día.
  - `distribution` con el `summary` del boceto da `[{ label: 'Acciones y CEDEARs', pct ≈ 52.3 }, { label: 'Caja', pct ≈ 47.7 }, { label: 'Obligaciones negociables', pct: 0 }]`. Con total 0, todos los `pct` dan 0, sin `NaN`.
- [ ] **Step 2: Run** `npx vitest run src/lib/resumen`. Expected: FAIL.
- [ ] **Step 3: Implement.** Umbrales como constantes con nombre: `LOSS_THRESHOLD = -0.30` y `DAY_DROP_THRESHOLD = -0.03`. Los números se formatean con `formatNumber`/`formatPct` (Task 2). `quantityLabel` de ON usa `fmtVn` de `src/lib/on-format.ts` sobre `quantity * 100`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(resumen): derive holdings rows, review items and distribution`

### Task 8: Gráfico de valor del Resumen

**Files:**
- Create: `src/lib/resumen/chart.ts`, `src/lib/resumen/__tests__/chart.test.ts`, `src/components/resumen/ValueChart.tsx`

**Interfaces:**
- Consumes: `GET /api/portfolio-history?days=<30|90|180|365|all>&universe=measurable`, que devuelve `{ data: { snapshot_date, value, invested, source?: 'live' | 'estimated' }[] }`.
- Produces:
  - `RANGES = [{ id: '1M', days: '30' }, { id: '3M', days: '90' }, { id: '6M', days: '180' }, { id: '1A', days: '365' }, { id: 'Todo', days: 'all' }] as const`
  - `buildChart(points, width: number, height: number): { valuePath: string; investedPath: string; yTicks: { y: number; label: string }[]; xTicks: { x: number; label: string }[]; xAt: (i: number) => number; yAt: (v: number) => number } | null`
  - `nearestIndex(clientX: number, left: number, width: number, count: number): number`
  - `historyNote(points): string`
  - `<ValueChart />`, que se ocupa de su propio fetch y de los estados.

- [ ] **Step 1: Write failing tests**
  - `buildChart([], 600, 220)` da `null`.
  - Un solo punto no lanza, `valuePath` empieza con `M` y no contiene `NaN`.
  - Con 3 puntos de valores 100, 200 y 150, el dominio y queda con margen e incluye `invested`.
  - `nearestIndex(250, 50, 400, 5)` da 2. Además, se mantiene dentro de `[0, count-1]` para x fuera del rango.
  - `historyNote` de puntos todos `live` da `'Acciones y caja. Las ONs no tienen historia todavía.'`.
  - Con 3 estimados de 10 da `'Acciones y caja. Las ONs no tienen historia todavía. 3 de 10 días son estimados.'`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**
  - `ValueChart` es un SVG como el boceto: línea `--accent` de 1,75 px y la de invertido punteada en `--ink-3`.
  - El ancho sale de `ResizeObserver`.
  - Selector de período `.seg` con radios: "3M" por defecto.
  - Tooltip con fecha larga es-AR, `US$ valor` y el resultado sobre lo invertido con signo.
  - `tabIndex=0`, flechas izquierda/derecha y `aria-label` como el del boceto.
  - Estados:
    - Cargando: un `.skel` de la altura del gráfico.
    - Error: el texto "No se pudo cargar la historia." con el botón "Reintentar".
    - Vacío: no se renderiza el gráfico y queda el texto "Todavía no hay historia para este período.".
  - Alto de 220 px, y 180 px por debajo de 820 px.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(resumen): add the portfolio value chart with keyboard and hover readout`

### Task 9: Página Resumen

**Files:**
- Rewrite: `src/app/dashboard/page.tsx`
- Create: en `src/components/resumen/`, `SummaryHeader.tsx`, `ValueSection.tsx`, `HoldingsList.tsx`, `HoldingsTable.tsx`, `ReviewList.tsx`, `DistributionList.tsx`, `MovementsList.tsx`, `AdjustCashDialog.tsx`, más `__tests__/HoldingsList.test.tsx` y `__tests__/ReviewList.test.tsx`
- Modify: `src/components/ui/ReconciliationBanner.tsx` y `src/components/ui/UnpricedNotice.tsx`. Solo se reestilizan con tokens, sin cambiar sus props. Ojo: `UnpricedNotice` tiene un test con `renderToStaticMarkup` que hay que mantener en verde, actualizando solo las aserciones de clases si las hay.

**Interfaces:**
- Consumes:
  - De Task 7: `buildHoldings`, `reviewItems` y `distribution`.
  - De Task 8: `ValueChart`.
  - De Task 2: `formatNumber`, `formatUSD` y `formatPct`.
  - Sin cambios: `AddTransactionModal` (incluye `initialData` para venta rápida), `ImportModal`, `buildAdjustPayload` (lo que usa hoy `CashSection`) e `isMarketOpen`.
  - Endpoints: `/api/positions`, `/api/cedears`, `/api/activos`, `/api/reconciliation`, `/api/cash/movements`, `DELETE /api/cash/movements/:id` y `POST /api/cash/adjust`.
- Produces: `/dashboard` igual al boceto.

- [ ] **Step 1: Write failing tests** (con `renderToStaticMarkup`)
  - `HoldingsList` con filas de ejemplo:
    - Renderiza los grupos "Acciones y CEDEARs", "Caja" y "Obligaciones negociables".
    - El link `DUK` tiene `href="/trading?symbol=DUK"`.
    - Una fila con `dayChangePct: null` muestra "Sin precio hoy".
    - Sin ONs muestra "No tenés ONs." y un link a `/ons`.
    - Contiene `−37,1 %`.
  - `ReviewList` con `[]` devuelve un string vacío, porque la sección no se muestra.
  - `HoldingsTable`:
    - Los encabezados ordenables son `<button>` dentro de `<th aria-sort>`.
    - Cada "Vender" tiene `aria-label="Vender DUK"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Composición, columnas, orden y celular como el boceto y la sección "Resumen" del spec.
  - Encabezado: "Tu cartera", la fecha larga es-AR y el estado del mercado. Se conserva la lógica de auto-refresco de hoy (`REFRESH_INTERVAL_SEC = 300`, verificación de mercado cada 60 s), mostrada como texto: "Mercado abierto, se actualiza en 4:12", "Pausado" o "Mercado cerrado, precios al cierre". Botones Importar y Nueva operación.
  - Debajo, `ReconciliationBanner` y `UnpricedNotice` reestilizados.
  - Columna izquierda:
    - `ValueSection`: total en serif, día, cifras y `ValueChart`.
    - `HoldingsList` con `id="tenencias"`. El toggle "Ver como tabla" / "Ver como lista" alterna con `HoldingsTable`.
    - "Vender" llama a la misma `handleQuickSell` de hoy, que abre `AddTransactionModal` con `initialData`.
    - En Caja, "Ajustar saldo" abre `AdjustCashDialog`.
  - Columna derecha: `ReviewList`, `DistributionList` y `MovementsList`.
    - `MovementsList` muestra los 4 más recientes de `/api/cash/movements` (`data.data`).
    - Cada uno tiene un botón ícono "Borrar movimiento del 22 jun" con confirmación.
    - "Ver todos" lleva a `/history`.
  - `AdjustCashDialog`: `<dialog>` nativo con campos asociados a sus labels (saldo real, fecha, descripción). Reutiliza `buildAdjustPayload`, muestra los mismos mensajes de éxito y error que `CashSection` y llama al refresco al terminar.
  - Estados:
    - Cargando: filas `.skel`.
    - Sin posiciones ni caja: "Todavía no cargaste operaciones." con el botón primario "Nueva operación".
    - Error en `/api/positions`: aviso con "Reintentar".
  - Pie: "Cotizaciones de BYMA y Yahoo Finance al cierre del {fecha}, {hora}.", con `lastRefresh` de `/api/positions`.
  - Quitar el uso de `PositionsTable`, `ONsSection`, `CashSection`, `KpiCard`, `glass` y `animate-*` en esta página. Esos archivos no se borran porque otras páginas pueden usarlos (verificarlo con grep antes de dejarlos).
- [ ] **Step 4: Run** `npm test && npm run type-check && npm run lint`. Expected: PASS.
- [ ] **Step 5: Verificación con datos reales** (ver abajo) sobre `/dashboard`, en claro y oscuro, con capturas a 390, 1024 y 1440 px. Se mira contra el boceto. Los montos tienen que coincidir con los de `/api/positions`: el total igual a `summary.total_market_value`, y la suma de los valores de Tenencias más caja igual al total, con ±0,01.
- [ ] **Step 6: Commit** `feat(resumen): rebuild the dashboard as the new summary screen`

### Verificación responsive (la usan los Tasks 3 y 9)

El script es descartable: va en el scratchpad y no se commitea. Usa el chromium en caché: `executablePath: '/home/stefano/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'`, con playwright desde `~/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs`.

- Hace login con la cuenta del usuario a partir de las variables de entorno `E` y `P`, que da el usuario.
- Por cada ruta y por cada ancho de la lista, con alto 900:
  - Comprueba que `document.documentElement.scrollWidth === ancho`.
  - Recolecta los `pageerror`.
- Saca capturas a 390, 1024 y 1440 px, en claro y oscuro.
- Cualquier diferencia o error es un fallo.
- Al terminar, matar el dev server.
