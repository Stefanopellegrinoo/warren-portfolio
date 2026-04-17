# Warren Portfolio

Full-stack investment portfolio tracker.  
**Stack:** Next.js 14 · TypeScript · Supabase · Tailwind · Vercel

---

## 📚 Documentation

- **[Authentication Flow](./docs/AUTH_FLOW.md)** - Detailed login/logout/refresh diagrams and middleware explanation
- **[Refresh Token Handling](./docs/REFRESH_TOKEN_HANDLING.md)** - Token lifecycle, storage, and rotation strategy

---

## Arquitectura

```
warren-portfolio/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── transactions/       GET/POST operaciones + /import + /closed
│   │   │   ├── positions/          GET posiciones con precios Yahoo Finance
│   │   │   ├── cashflow/           GET/POST/PATCH flujos de caja
│   │   │   └── portfolio-history/  GET/POST snapshots para gráfico
│   │   ├── dashboard/              Vista principal: KPIs + tabla + gráfico
│   │   ├── history/                Historial de operaciones cerradas
│   │   ├── cashflow/               Gastos y flujos
│   │   └── auth/login/             Login / Signup
│   ├── components/
│   │   ├── ui/                     KpiCard, PositionsTable, AddTransactionModal, ImportModal
│   │   ├── charts/                 PortfolioChart (Recharts)
│   │   └── layout/                 Sidebar
│   ├── lib/
│   │   ├── portfolio-engine.ts     ⭐ Algoritmo costo promedio móvil correcto
│   │   ├── supabase.ts             Clientes browser/server/service
│   │   ├── excel-import.ts         Parser de .xlsx
│   │   └── utils.ts                formatUSD, formatPct, cn, etc.
│   ├── types/index.ts              Todos los tipos TypeScript
│   └── middleware.ts               Auth guard (redirige a login si no hay sesión)
└── supabase/migrations/001_schema.sql   Schema completo con RLS
```

---

## Setup en 5 pasos

### 1. Supabase

1. Crear proyecto en [supabase.com](https://supabase.com)
2. Ir a **SQL Editor** → pegar y ejecutar `supabase/migrations/001_schema.sql`
3. En **Authentication → URL Configuration** agregar:
   - Site URL: `https://tu-app.vercel.app`
   - Redirect URL: `https://tu-app.vercel.app/auth/callback`

### 2. Variables de entorno

```bash
cp .env.local.example .env.local
```

Completar con los datos de tu proyecto Supabase:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

Las keys están en **Supabase → Settings → API**.

### 3. Instalar y correr local

```bash
npm install
npm run dev
# → http://localhost:3000
```

### 4. Deploy en Vercel

```bash
# Opción A: desde CLI
npm i -g vercel
vercel --prod

# Opción B: conectar repositorio en vercel.com
# → Add New Project → importar repo → agregar env vars → Deploy
```

**Variables en Vercel:** Settings → Environment Variables → agregar las 3 vars del `.env.local`.

### 5. Importar datos históricos

Una vez deployado:
1. Registrarse en la app
2. Dashboard → **Importar Excel** → subir el `WarrenPortfolio_GS.xlsx`  
   (detecta automáticamente la hoja `REGISTRO_INVERSIONES`)
3. Activar **"Reemplazar todo"** si es primera importación
4. Hacer click en **Snapshot** para guardar el primer punto del gráfico

---

## Cómo funciona el algoritmo de costo promedio

El engine en `src/lib/portfolio-engine.ts` procesa las transacciones **en orden cronológico**:

```
COMPRA 10 NVDA @ $118  →  cost_basis = $1,180  |  qty = 10  |  avg = $118
VENTA  10 NVDA @ $166  →  cost_basis = $0      |  qty = 0   |  avg = $0    (posición cerrada)
COMPRA 45 NVDA @ $190  →  cost_basis = $8,740  |  qty = 45  |  avg = $190  ✓ correcto
```

Cuando hay una venta, el cost_basis se reduce proporcionalmente al promedio vigente.  
Cuando la posición llega a 0, el contador se resetea completamente.  
Esto es imposible de hacer con fórmulas de hoja de cálculo — requiere lógica secuencial.

---

## Agregar nueva operación

Dos formas:
- **Manual:** Dashboard → Nueva Operación → completar el formulario
- **Excel:** Dashboard → Importar Excel → subir .xlsx con columnas: `FECHA | TICKER | OPERACIÓN | CANTIDAD | PRECIO | COMISIÓN`

Al guardar cualquier operación, el sistema:
1. Recalcula el costo promedio ponderado móvil para ese ticker
2. Actualiza la tabla `positions` con el nuevo avg_cost y quantity
3. Si la posición se cerró (qty → 0), escribe en `closed_trades` y borra la posición
4. El dashboard refleja los cambios inmediatamente

---

## Estructura de la base de datos

| Tabla | Descripción |
|-------|-------------|
| `transactions` | Todas las operaciones (compras, ventas, dividendos) |
| `positions` | Posiciones abiertas actuales con avg_cost correcto |
| `closed_trades` | Historial de posiciones cerradas con P&L realizado |
| `cashflow` | Gastos, honorarios y flujos de caja |
| `portfolio_snapshots` | Snapshots diarios para el gráfico de evolución |

Todas las tablas tienen **Row Level Security (RLS)** — cada usuario solo ve sus propios datos.

---

## Precios en tiempo real

Los precios se obtienen de **Yahoo Finance** via la librería `yahoo-finance2`.  
Conversión de tickers: `NASDAQ:NVDA → NVDA`, `BCBA:VIST → VIST.BA`, etc.

Los precios se fetchen en tiempo real al cargar el dashboard — no se almacenan en DB para evitar stale data.

---

## Snapshot / Gráfico de evolución

El gráfico muestra la evolución del portfolio en el tiempo.  
Para que funcione hay que guardar snapshots periódicamente:

- **Manual:** Dashboard → botón "Snapshot" (guarda el valor actual)
- **Automático:** configurar un cron job en Vercel que llame `POST /api/portfolio-history`

```bash
# Cron en vercel.json (opcional)
{
  "crons": [{
    "path": "/api/portfolio-history",
    "schedule": "0 22 * * 1-5"
  }]
}
```

---

## 🔐 Autenticación

Warren Portfolio usa **Supabase Auth** con OAuth 2.0 para login seguro.

### Login Flow

1. User clicks "Login with GitHub"
2. Redirects to GitHub OAuth authorization
3. GitHub redirects back to `/auth/callback?code={AUTH_CODE}`
4. Server exchanges code for tokens (access + refresh)
5. Tokens stored in HTTP-only cookies (secure, auto-managed)
6. Middleware validates session on every protected route
7. Access token auto-refreshes when expired (transparent to user)

### Middleware Session Validation

**File:** `src/middleware.ts`

```typescript
export async function middleware(req: NextRequest) {
  // Protected routes that require authentication
  const protectedPaths = ['/dashboard', '/history', '/cashflow', '/statistics'];
  
  // Check if current route needs protection
  const isProtected = protectedPaths.some((p) => req.nextUrl.pathname.startsWith(p));
  
  if (!isProtected) return NextResponse.next();
  
  // Create Supabase client and check session
  const supabase = createSupabaseServerClient(req, res);
  const { data: { session } } = await supabase.auth.getSession();
  
  // Auto-refresh happens here if access token expired
  if (!session) {
    return NextResponse.redirect(new URL('/auth/login', req.url));
  }
  
  return NextResponse.next();
}
```

**Token Auto-Refresh:**
- Middleware checks session → triggers refresh if access token expired
- API routes use `createServerClientInstance()` → auto-refresh on `getSession()`
- Browser-side auth changes trigger automatic sync
- User never manually needs to refresh

### Security

✅ **HTTP-Only Cookies** - Tokens never exposed to JavaScript (prevents XSS)  
✅ **Secure Flag** - Cookies only sent over HTTPS  
✅ **SameSite=Lax** - CSRF protection  
✅ **Token Rotation** - Access tokens valid 1 hour, refresh tokens valid 7 days  
✅ **Session Timeout** - Users idle >7 days must re-authenticate  

### Cookie Storage

Supabase SSR manages cookies automatically:

```
sb-{project-id}-auth-token              → Access token (1 hour)
sb-{project-id}-auth-token-refreshed    → Refresh token (7 days)
```

### Detailed Documentation

For complete authentication flow diagrams, token handling, and error scenarios, see:
- **[Authentication Flow](./docs/AUTH_FLOW.md)** - Login/logout/refresh diagrams + middleware details
- **[Refresh Token Handling](./docs/REFRESH_TOKEN_HANDLING.md)** - Token lifecycle and rotation strategy

---
