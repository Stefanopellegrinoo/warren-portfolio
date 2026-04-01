# 📊 REFACTOREO COMPLETO - WARREN-PORTFOLIO
## Multi-Asset Support (Acciones + ONs + Cash)

**Fecha**: 2026-03-31  
**Estado**: FASE 1 COMPLETADA ✅  
**Archivos generados**: Este documento + engram persistence

---

## 📋 ÍNDICE
1. [Contexto y Objetivo](#contexto-y-objetivo)
2. [Análisis de Arquitectura Actual](#análisis-de-arquitectura-actual)
3. [Especificaciones (SDD SPEC)](#especificaciones-sdd-spec)
4. [Diseño Técnico (SDD DESIGN)](#diseño-técnico-sdd-design)
5. [Task Breakdown (49 tareas)](#task-breakdown-49-tareas)
6. [Implementación por Fases](#implementación-por-fases)
7. [Estado Actual y Próximos Pasos](#estado-actual-y-próximos-pasos)

---

## 🎯 CONTEXTO Y OBJETIVO

### Objetivo Principal
Refactorear el proyecto **warren-portfolio** (Next.js 14 + Supabase + Redis) para soportar **tres tipos de activos**:
1. **Acciones/CEDEARs** (existente)
2. **ONs (Obligaciones Negociables)**
3. **Cash (USD)**

### Requisitos del Usuario
1. Dashboard que muestre TODAS las posiciones divididas por tipo de activo (Opción A confirmada: secciones separadas con totales por sección + total general arriba)
2. Flujo de "Nueva Operación" con paso previo para seleccionar tipo de activo (ACCIONES vs ON)
3. Sistema de tracking de efectivo/liquidez bien diseñado
4. **TODO debe seguir funcionando — NO romper lo existente**

### Restricciones Clave
- **Zero breaking changes**: Migración 100% aditiva
- **Backward compatibility**: Funcionalidad existente intacta
- **Performance**: Mantener tablas separadas con índices apropiados
- **Seguridad**: RLS policies para todas las nuevas tablas

---

## 🔍 ANÁLISIS DE ARQUITECTURA ACTUAL

### Estructura del Proyecto (`/home/stefano/proyectos/warren-portfolio/`)
- **Next.js 14** con App Router
- **Supabase** para base de datos (PostgreSQL)
- **Redis** para cache
- **TypeScript** con tipos definidos en `src/types/index.ts`

### Tablas Existentes (Supabase)
```
transactions          # Todas las transacciones (asset_type: ACCION|CEDEAR)
positions             # Posiciones abiertas de stocks
closed_trades         # Operaciones cerradas de stocks
cashflow              # Gastos personales ARS (NO portfolio cash balance)
portfolio_snapshots   # Snapshots históricos
```

### Flujo Actual - Nueva Operación
```
1. Click "Nueva Operación" → `AddTransactionModal.tsx`
2. Tab de operación: COMPRA | VENTA | DIVIDENDO
3. Tab de tipo: ACCION | CEDEAR
4. POST a `/api/transactions` → `portfolio-engine.ts` → `rebuildPosition()`
```

### Hallazgos Críticos
1. **Tabla `positions` NO tiene columna `asset_type`** - solo `transactions` la guarda
2. **Cálculo weighted average** en `portfolio-engine.ts` usa `calculateRunningAvgCost()` - misma lógica aplica a ONs
3. **`rebuildPosition()`** recalcula TODA la posición desde cero - patrón seguro para integridad de datos
4. **Cache Redis** invalida `summary:${userId}` después de cambios

---

## 📝 ESPECIFICACIONES (SDD SPEC)

### 1. Obligaciones Negociables (ONs)

#### Campos Requeridos
| Campo | Tipo | Descripción |
|-------|------|-------------|
| ticker | string | Identificador de la ON (ej: "YPF2026") |
| valor_nominal | number | Valor nominal en USD |
| fecha_compra | date | Fecha de adquisición |
| fecha_vencimiento | date | Fecha de madurez del bono |
| tasa_cupon | number | Tasa de cupón anual (%) |
| precio_compra | number | Precio pagado (% del nominal) |
| cantidad | number | Cantidad de láminas/nominales |

#### Métricas a Mostrar
- **Cambio % total**: (valor_actual - costo_total) / costo_total
- **Cambio nominal total**: valor_actual - costo_total
- **Cambio % diario**: variación del precio desde cierre anterior
- **Cambio nominal diario**: cambio % diario * valor_actual
- **Yield to maturity** (opcional futuro)
- **Días hasta vencimiento**

#### Operaciones Soportadas
| Operación | Efecto en ON | Efecto en Cash |
|-----------|--------------|----------------|
| COMPRA | Crea/aumenta posición | Resta monto |
| VENTA | Reduce/cierra posición | Suma monto |
| CUPON | Sin efecto | Suma monto del cupón |

### 2. Cash (USD únicamente)

#### Modelo
El cash es un **SALDO** que se actualiza automáticamente con cada operación. NO es un activo que se compra/vende.

#### Operaciones que afectan Cash
| Operación | Efecto |
|-----------|--------|
| COMPRA (acción/ON) | - (resta el total pagado) |
| VENTA (acción/ON) | + (suma el total recibido) |
| DIVIDENDO | + (suma el monto) |
| CUPON | + (suma el monto) |
| DEPOSITO | + (suma el monto) |
| RETIRO | - (resta el monto) |

#### Persistencia
- **Tabla `cash_balance`**: saldo actual (una fila por usuario)
- **Tabla `cash_movements`**: historial completo de movimientos

### 3. Dashboard (3 Secciones)

#### KPIs Header
```
┌─────────────────────────────────────────────────────┐
│  TOTAL PORTFOLIO: $125,430                          │
│  ├── Acciones: $85,000 (67.8%)                      │
│  ├── ONs: $35,000 (27.9%)                           │
│  └── Cash: $5,430 (4.3%)                            │
│                                                     │
│  P&L Total: +$12,500 (+11.1%)                       │
│  P&L Día: +$340 (+0.27%)                            │
└─────────────────────────────────────────────────────┘
```

#### Secciones del Dashboard
1. **Acciones/CEDEARs** - Tabla existente con subtotal
2. **Obligaciones Negociables** - Nueva tabla con:
   - Ticker, Nominales, Costo, Valor Actual, P&L %, P&L $, Vencimiento
   - Subtotal sección
3. **Cash** - Card simple con:
   - Saldo actual
   - Últimos 5 movimientos

### 4. Nueva Operación (Modal de 2 pasos)

#### Flujo
```
Paso 1: Elegir tipo de activo
┌────────────────────────────────────────┐
│  ¿Qué tipo de operación?               │
│                                        │
│  [ACCIÓN/CEDEAR]  [ON]  [CASH]         │
└────────────────────────────────────────┘

Paso 2: Formulario específico según tipo
```

#### Formulario ON
| Campo | Tipo | Requerido |
|-------|------|-----------|
| Operación | COMPRA/VENTA/CUPON | Sí |
| Ticker | combobox con ONs | Sí |
| Cantidad nominales | number | Sí (COMPRA/VENTA) |
| Precio (% nominal) | number | Sí (COMPRA/VENTA) |
| Monto cupón | number | Sí (solo CUPON) |
| Fecha vencimiento | date | Sí (solo COMPRA nueva) |
| Comisión | number | No |
| Notas | text | No |

#### Formulario CASH
| Campo | Tipo | Requerido |
|-------|------|-----------|
| Operación | DEPOSITO/RETIRO | Sí |
| Monto | number | Sí |
| Descripción | text | No |
| Fecha | date | Sí |

---

## 🏗️ DISEÑO TÉCNICO (SDD DESIGN)

### 1. Database Migrations

#### Nueva migración: `003_multi_asset_support.sql`
```sql
-- ON POSITIONS (separate from stock positions)
CREATE TABLE on_positions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ticker          text NOT NULL,
  nominal_amount  numeric(18,4) NOT NULL DEFAULT 0,    -- cantidad de nominales
  avg_cost_pct    numeric(10,6) NOT NULL DEFAULT 0,    -- precio promedio como % del nominal
  total_invested  numeric(18,4) NOT NULL DEFAULT 0,    -- nominal * avg_cost_pct
  maturity_date   date NOT NULL,                       -- fecha vencimiento
  coupon_rate     numeric(6,4),                        -- tasa cupón anual (opcional)
  first_bought    date,
  last_updated    timestamptz DEFAULT now(),
  UNIQUE(user_id, ticker)
);

-- ON CLOSED TRADES
CREATE TABLE on_closed_trades (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ticker        text NOT NULL,
  open_date     date NOT NULL,
  close_date    date NOT NULL,
  days_held     int GENERATED ALWAYS AS (close_date - open_date) STORED,
  avg_cost_pct  numeric(10,6) NOT NULL,
  close_pct     numeric(10,6) NOT NULL,
  nominal_amount numeric(18,4) NOT NULL,
  invested      numeric(18,4) NOT NULL,
  proceeds      numeric(18,4) NOT NULL,
  pnl           numeric(18,4) GENERATED ALWAYS AS (proceeds - invested) STORED,
  pnl_pct       numeric(10,6) GENERATED ALWAYS AS ((proceeds - invested) / NULLIF(invested,0)) STORED,
  created_at    timestamptz DEFAULT now()
);

-- CASH BALANCE (single row per user)
CREATE TABLE cash_balance (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  balance_usd   numeric(18,4) NOT NULL DEFAULT 0,
  last_updated  timestamptz DEFAULT now()
);

-- CASH MOVEMENTS (history)
CREATE TABLE cash_movements (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date          date NOT NULL,
  operation     text NOT NULL CHECK (operation IN ('DEPOSITO','RETIRO','COMPRA','VENTA','DIVIDENDO','CUPON')),
  amount        numeric(18,4) NOT NULL,  -- positive = inflow, negative = outflow
  description   text,
  related_tx_id uuid,                    -- links to transactions.id if applicable
  created_at    timestamptz DEFAULT now()
);

-- RLS POLICIES
ALTER TABLE on_positions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE on_closed_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_balance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_on_positions"     ON on_positions     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_on_closed_trades" ON on_closed_trades FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_cash_balance"     ON cash_balance     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_cash_movements"   ON cash_movements   FOR ALL USING (auth.uid() = user_id);

-- INDEXES
CREATE INDEX idx_on_positions_user    ON on_positions(user_id);
CREATE INDEX idx_on_closed_user       ON on_closed_trades(user_id);
CREATE INDEX idx_cash_balance_user    ON cash_balance(user_id);
CREATE INDEX idx_cash_movements_user  ON cash_movements(user_id, date);
```

### 2. Type System Changes

#### Actualizar `src/types/index.ts`
```typescript
// Expand Operation type
export type Operation = 'COMPRA' | 'VENTA' | 'DIVIDENDO' | 'CUPON' | 'DEPOSITO' | 'RETIRO'

// Expand AssetType
export type AssetType = 'ACCION' | 'CEDEAR' | 'ON' | 'CASH'

// New: ON Position
export interface ONPosition {
  id: string
  user_id: string
  ticker: string
  nominal_amount: number
  avg_cost_pct: number       // precio como % del nominal (0.95 = 95%)
  total_invested: number
  maturity_date: string
  coupon_rate: number | null
  first_bought: string | null
  last_updated: string
  // enriched client-side
  current_price_pct?: number  // cotización actual como %
  market_value?: number
  pnl?: number
  pnl_pct?: number
  days_to_maturity?: number
}

// New: Cash Balance
export interface CashBalance {
  id: string
  user_id: string
  balance_usd: number
  last_updated: string
}

// New: Cash Movement
export interface CashMovement {
  id: string
  user_id: string
  date: string
  operation: 'DEPOSITO' | 'RETIRO' | 'COMPRA' | 'VENTA' | 'DIVIDENDO' | 'CUPON'
  amount: number
  description: string | null
  related_tx_id: string | null
  created_at: string
}

// Expand Portfolio Summary
export interface PortfolioSummary {
  // existing fields...
  total_market_value: number
  total_invested: number
  open_pnl: number
  open_pnl_pct: number
  day_pnl: number
  day_pnl_pct: number
  realized_pnl: number
  realized_pnl_pct: number
  positions_count: number
  best_performer: Position | null
  worst_performer: Position | null
  
  // NEW: breakdown by asset type
  stocks_value: number
  stocks_pnl: number
  ons_value: number
  ons_pnl: number
  cash_balance: number
}
```

### 3. Engine Architecture

#### 3.1 Nuevo archivo: `src/lib/on-engine.ts`
Similar a `portfolio-engine.ts` pero para bonos:
- Prices como porcentajes del nominal (0.95 = 95%)
- Tracking de fecha de vencimiento
- Operación CUPON agrega a cash sin afectar posición

#### 3.2 Nuevo archivo: `src/lib/cash-engine.ts`
Gestiona saldo de efectivo:
- Llamado por transacciones de acciones y ONs
- Operaciones directas (DEPOSITO/RETIRO)
- Balance se recalcula desde cero para integridad

#### 3.3 Modificar `src/lib/portfolio-engine.ts`
- Agregar `updateCashBalance()` en `processTransaction()`
- Expandir `calculatePortfolioSummary()` para incluir ONs y cash

### 4. API Changes

#### Nuevos Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/on/transactions` | POST | Create ON transaction |
| `/api/on/positions` | GET | Get ON positions |
| `/api/cash` | GET | Get cash balance |
| `/api/cash/transactions` | POST | Create cash transaction |
| `/api/cash/movements` | GET | Get cash movements history |

#### Modificar `/api/dashboard`
```typescript
// Return expanded summary
return {
  positions,      // stock positions (existing)
  onPositions,    // NEW: ON positions
  cashBalance,    // NEW: cash balance
  summary: {
    // existing...
    stocks_value,
    stocks_pnl,
    ons_value,
    ons_pnl,
    cash_balance,
  }
}
```

### 5. Component Architecture

#### Modal Nueva Operación (refactor)
```
AddTransactionModal
├── Step 1: AssetTypeSelector
│   └── [ACCIÓN/CEDEAR] [ON] [CASH]
│
└── Step 2: (conditional)
    ├── StockTransactionForm (existing, extracted)
    ├── ONTransactionForm (new)
    └── CashTransactionForm (new)
```

#### Nuevos Componentes Necesarios
| Component | Location | Purpose |
|-----------|----------|---------|
| `AssetTypeSelector` | `components/ui/` | Step 1 of modal |
| `ONTransactionForm` | `components/ui/` | ON form fields |
| `CashTransactionForm` | `components/ui/` | Cash form fields |
| `ONPositionCard` | `components/` | ON position display |
| `ONsSection` | `components/` | ON section wrapper |
| `CashSection` | `components/` | Cash section |
| `CashMovementRow` | `components/` | Single movement |

---

## 📋 TASK BREAKDOWN (49 tareas)

### PHASE 1: Database & Types (Foundation) — 8 tareas ✅ COMPLETADA
**✅ Estado**: Migration 003 creada, tipos TypeScript extendidos

1. **✅ 1.1 Create Migration 003 — ON Tables** - `on_positions`, `on_closed_trades`
2. **✅ 1.2 Create Migration 003 — Cash Tables** - `cash_balance`, `cash_movements`
3. **✅ 1.3 Add RLS Policies to New Tables** - auth.uid() = user_id
4. **✅ 1.4 Add Indexes for New Tables** - user_id, date indexes
5. **✅ 1.5 Extend TypeScript Types — ON Types** - ONPosition, ONClosedTrade
6. **✅ 1.6 Extend TypeScript Types — Cash Types** - CashBalance, CashMovement
7. **✅ 1.7 Extend AssetType Enum** - 'ACCION' | 'CEDEAR' | 'ON'
8. **✅ 1.8 Update PortfolioSummary for Multi-Asset** - stocks/ons/cash breakdown

### PHASE 2: Cash Engine & API — 6 tareas ⏳ PENDIENTE
9. **⏳ 2.1 Create cash-engine.ts — Core Logic** - processCashMovement, rebuildCashBalance
10. **⏳ 2.2 Create API Route — POST /api/cash** - DEPOSITO/RETIRO
11. **⏳ 2.3 Create API Route — GET /api/cash** - get current balance
12. **⏳ 2.4 Create API Route — GET /api/cash/movements** - history
13. **⏳ 2.5 Create API Route — DELETE /api/cash/movements/[id]** - delete movement
14. **⏳ 2.6 Add Cash to Redis Cache Invalidation** - del(`summary:${userId}`)

### PHASE 3: ON Engine & API — 7 tareas ⏳ PENDIENTE
15. **⏳ 3.1 Create on-engine.ts — Core Logic** - COMPRA/VENTA/CUPON
16. **⏳ 3.2 Create API Route — POST /api/on-positions** - ON transactions
17. **⏳ 3.3 Create API Route — GET /api/on-positions** - ON positions
18. **⏳ 3.4 Create IOL Price Fetcher** - fetchIOLPrice(), fetchIOLPrices()
19. **⏳ 3.5 Create API Route — GET /api/on-positions/quotes** - real-time ON quotes
20. **⏳ 3.6 Create API Route — GET /api/on-positions/closed** - ON closed trades
21. **⏳ 3.7 Add ON Worker to BullMQ Price Worker** - updateONPrices()

### PHASE 4: Portfolio Engine Integration — 4 tareas ⏳ PENDIENTE
22. **⏳ 4.1 Modify calculatePortfolioSummary — Add ON Support** - breakdown logic
23. **⏳ 4.2 Create Unified Portfolio Fetcher** - getFullPortfolio()
24. **⏳ 4.3 Modify GET /api/positions — Use getFullPortfolio** - multi-asset response
25. **⏳ 4.4 Add Multi-Asset to Redis Cache** - cache invalidation pattern

### PHASE 5: Modal Nueva Operación (2-step) — 5 tareas ⏳ PENDIENTE
26. **⏳ 5.1 Create AddTransactionModal — Step 1** - AssetTypeSelector
27. **⏳ 5.2 Create AssetTypeSelector Component** - 3 option buttons
28. **⏳ 5.3 Create StockTransactionForm** - extracted existing form
29. **⏳ 5.4 Create ONTransactionForm Component** - ON-specific fields
30. **⏳ 5.5 Create CashMovementForm Component** - DEPOSITO/RETIRO form

### PHASE 6: Dashboard with 3 Sections — 6 tareas ⏳ PENDIENTE
31. **⏳ 6.1 Create Dashboard Layout with 3 Sections** - Stocks/ONs/Cash sections
32. **⏳ 6.2 Create GlobalKPIs Component** - totals + breakdown
33. **⏳ 6.3 Create StocksSection Component** - existing table adapted
34. **⏳ 6.4 Create ONsSection Component** - ON positions table
35. **⏳ 6.5 Create CashSection Component** - balance + recent movements
36. **⏳ 6.6 Update Dashboard Page** - integrate all sections

### PHASE 7: IOL API Integration — 4 tareas ⏳ PENDIENTE
37. **⏳ 7.1 Create IOL Authentication Bridge** - OAuth2 token handling
38. **⏳ 7.2 Create IOL ON Price Fetcher** - fetchIOLONPrice()
39. **⏳ 7.3 Add IOL to Price Worker** - periodic ON price updates
40. **⏳ 7.4 Create ON Ticker Search** - buscar ONs por nombre/ticker

### PHASE 8: Testing & Validation — 5 tareas ⏳ PENDIENTE
41. **⏳ 8.1 Unit Tests — cash-engine.ts** - balance calculations
42. **⏳ 8.2 Unit Tests — on-engine.ts** - COMPRA/VENTA/CUPON
43. **⏳ 8.3 Integration Tests — API endpoints** - POST/GET endpoints
44. **⏳ 8.4 E2E Test — Modal Flow** - 2-step transaction flow
45. **⏳ 8.5 Performance Test — Portfolio Summary** - multi-asset calc

### PHASE 9: Deployment & Monitoring — 4 tareas ⏳ PENDIENTE
46. **⏳ 9.1 Migration Rollback Plan** - backup/restore procedure
47. **⏳ 9.2 Performance Monitoring** - query times, cache hit rates
48. **⏳ 9.3 Error Tracking Setup** - Sentry/LogRocket integration
49. **⏳ 9.4 Documentation Update** - README, API docs, user guide

---

## 🚀 IMPLEMENTACIÓN POR FASES

### Orden de Implementación (Recomendado)
1. **FASE 1** (✅ COMPLETADA) - Foundation
2. **FASE 2** - Cash Engine (más simple, sin dependencias)
3. **FASE 3** - ON Engine (similar a stock engine)
4. **FASE 4** - Portfolio Integration
5. **FASE 5** - Modal Nueva Operación
6. **FASE 6** - Dashboard Sections
7. **FASE 7** - IOL Integration
8. **FASE 8** - Testing
9. **FASE 9** - Deployment

### Backward Compatibility
- ✅ **Tablas nuevas**: `on_positions`, `on_closed_trades`, `cash_balance`, `cash_movements`
- ✅ **Tablas existentes**: NO modificadas
- ✅ **API existente**: `/api/transactions`, `/api/positions` siguen funcionando
- ✅ **Tipos TypeScript**: Evolución sin breaking changes

### Migration Path
1. Run migration 003 (creates new tables)
2. Deploy new code
3. Users start with $0 cash balance
4. Users do DEPOSITO to set initial cash
5. All subsequent transactions update cash automatically

---

## 📊 ESTADO ACTUAL Y PRÓXIMOS PASOS

### ✅ COMPLETADO
**PHASE 1: Database & Types**
- Migration 003 creada (93 líneas, 100% aditiva)
- TypeScript types extendidos
- PortfolioSummary actualizado
- TypeScript compila sin errores (`tsc --noEmit`)
- RLS policies configuradas

### ⏳ PENDIENTE (PHASES 2-9)
41 tareas restantes organizadas en 8 fases

### 🎯 Próximo Paso Recomendado: PHASE 2 (Cash Engine)
**Razón**: Es la fase más simple, no tiene dependencias externas, establece el patrón para las demás fases.

**Tareas específicas a hacer ahora**:
1. **2.1 Create cash-engine.ts** - Lógica core de cash
2. **2.2 Create API Route — POST /api/cash** - Endpoint básico
3. **Test manual**: DEPOSITO aumenta balance, RETIRO disminuye

### 📈 Riesgos y Mitigaciones
| Risk | Mitigation |
|------|------------|
| Cash balance negativo | Validación en cash-engine antes de update |
| Precios ON no disponibles | Input manual (v1), mostrar "N/A" |
| UX modal complejo | Flujo de 2 pasos simplifica decisión |
| Performance con más datos | Tablas separadas, índices en lugar |
| Breaking existing functionality | Tablas nuevas solamente, código existente intacto |

---

## 📁 ARCHIVOS CRÍTICOS

### Archivos Nuevos
| File | Status |
|------|--------|
| `supabase/migrations/003_multi_asset_support.sql` | ✅ CREADO |
| `src/lib/on-engine.ts` | ⏳ PENDIENTE |
| `src/lib/cash-engine.ts` | ⏳ PENDIENTE |
| `src/app/api/on/transactions/route.ts` | ⏳ PENDIENTE |
| `src/app/api/cash/route.ts` | ⏳ PENDIENTE |

### Archivos Modificados
| File | Changes |
|------|---------|
| `src/types/index.ts` | ✅ EXTENDIDO |
| `src/lib/portfolio-engine.ts` | ✅ MINIMAL FIX |
| `src/components/ui/AddTransactionModal.tsx` | ⏳ REFACTOR |
| `src/app/dashboard/page.tsx` | ⏳ REFACTOR |
| `src/app/api/dashboard/route.ts` | ⏳ EXTEND |

---

## 🎯 RESUMEN EJECUTIVO

**ESTADO**: **FASE 1 COMPLETADA** ✅  
**PRÓXIMO**: **PHASE 2 (Cash Engine)** ⏳  
**RESTANTE**: **41 tareas en 8 fases** 📋  
**RIESGO**: **BAJO** (migración 100% aditiva) 🟢  

**Recomendación**: Continuar con PHASE 2 (Cash Engine) que establece el patrón base y es la fase más simple. Una vez que cash funciona, pasar a PHASE 3 (ON Engine) que sigue lógica similar a la existente.

---

**Documentación generada desde engram**: 2026-03-31  
**Contiene**: 9 memorias completas del proyecto warren-portfolio  
**Propósito**: Recuperar contexto completo para sesiones futuras