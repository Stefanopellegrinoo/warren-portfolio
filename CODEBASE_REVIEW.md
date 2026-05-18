# Warren Portfolio - Rigorous Codebase Review (Updated May 2026)

Este documento detalla la arquitectura del sistema y el análisis técnico del proyecto, identificando vulnerabilidades, cuellos de botella y deudas técnicas críticas.

## 0. System Architecture

El proyecto está diseñado como una plataforma de gestión de carteras de inversión de alta performance, utilizando un stack moderno y escalable.

### 0.1 Technology Stack
- **Frontend & API:** Next.js 14+ (App Router) con TypeScript.
- **Styling:** Tailwind CSS + Radix UI (shadcn/ui).
- **Database:** Supabase (Postgres) con Row Level Security (RLS) activo para multi-tenancy.
- **Cache & Queues:** Redis (Upstash/Self-hosted) + BullMQ para procesamiento asincrónico.
- **Deployment:** Vercel (Frontend/API) + Docker para Workers.

### 0.2 Async Processing & Workers
El sistema utiliza una arquitectura basada en eventos y colas para tareas pesadas:
- **Price Updates:** Un worker dedicado (`price-worker.ts`) procesa actualizaciones de precios mediante Yahoo Finance e IOL, gestionadas por BullMQ (`price-updates`).
- **Batch Imports:** Las importaciones de Excel/CSV se delegan a un worker asincrónico (`import-worker.ts`) para evitar timeouts en el cliente y garantizar la atomicidad via SQL RPC.

### 0.3 Logical Domain Layers (Engines)
La lógica de negocio está encapsulada en "Engines" especializados en `src/lib/`:
- **Portfolio Engine:** Lógica de activos de renta variable (Acciones/CEDEARs). Gestión de costos promedio ponderados y posiciones.
- **ON Engine:** Especializado en Obligaciones Negociables (Renta Fija), con soporte para cupones y validaciones de moneda (USD MEP).
- **Cash Engine:** Motor de movimientos de caja y balance consolidado.
- **Concurrency Engine:** Implementación propia de **Bloqueo Optimista** (`versioning`) para evitar race conditions en actualizaciones concurrentes.

---

## 1. Architectural Integrity & Atomicity

### 1.1 Progress: Atomic SQL RPC Implementation ✅
Se ha implementado satisfactoriamente el RPC `process_transaction_atomic` (Migración 014). Esto garantiza que la inserción de la transacción, el movimiento de caja, el balance y la posición básica ocurran en una única operación de base de datos.
- **Impacto:** Eliminado el riesgo de inconsistencia entre transacciones y balance de caja.

### 1.2 The "Post-RPC Rebuild" Fragility (New Critical Issue) ⚠️
En `portfolio-engine.ts` y `on-engine.ts`, después de ejecutar el RPC atómico, se invoca a `rebuildPosition`. 
- **The Risk:** Esta llamada ocurre fuera de la transacción de la DB. Si el proceso de Node falla entre el RPC y el rebuild, los `closed_trades` no se actualizan.
- **Redundancy & Conflict:** El RPC ya actualiza la tabla `positions` con bloqueo optimista/pesimista. `rebuildPosition` vuelve a hacer un `upsert` a la misma tabla pero **resetea el `version` a 1** (línea 467 de `portfolio-engine.ts`), rompiendo cualquier intento de control de concurrencia que el RPC haya intentado proteger.
- **Recommendation:** Mover la lógica de `closed_trades` adentro de un Trigger de Postgres o incluirla en el RPC. **Eliminar el upsert redundante en `rebuildPosition`** si se llama después de un proceso atómico.

### 1.3 Inefficient Closed Trade Calculation
`rebuildPosition` borra TODOS los `closed_trades` de un ticker y los vuelve a insertar en cada `VENTA`.
- **The Risk:** Para usuarios con miles de operaciones, esto es prohibitivamente lento y genera un churn innecesario en la DB.
- **Recommendation:** Implementar una lógica incremental para `closed_trades`.

## 2. Security & RLS

### 2.1 Service Role Key Overuse
Aunque `processTransaction` ahora usa correctamente `createServerClientInstance()`, funciones core como `rebuildPosition`, `rebuildCashBalance` y los workers de precios siguen casados con `createServiceClient()`.
- **The Risk:** Al bypassear RLS, cualquier error en el paso del `userId` (como un valor undefined o null que se filtre) podría resultar en operaciones sobre datos de otros usuarios o corrupción global.
- **Recommendation:** Solo los background jobs (BullMQ) deberían usar el `service_role`. Toda lógica disparada por una API de Next.js debe heredar el contexto del usuario.

## 3. Logic & Concurrency

### 3.1 CUPON/DIVIDENDO Consistency ✅
**Solucionado:** El RPC ahora inserta correctamente registros en la tabla `transactions` para operaciones de `CUPON` y `DIVIDENDO`, asegurando un historial completo y auditable.

### 3.2 Optimistic Locking Retry ✅
**Solucionado:** Se corrigió el error en `src/lib/concurrency.ts` donde se reusaba el builder de la query. Ahora la query se construye correctamente dentro del loop de reintento.

## 4. Performance

### 4.1 Parallel Rebuilds in Batch Imports ✅
**Solucionado:** `processTransactionBatch` ahora utiliza `Promise.all` con los tickers únicos para reconstruir posiciones en paralelo, reduciendo drásticamente el tiempo de importación de archivos Excel grandes.

### 4.2 Missing Asset Support in Atomic Batch
El RPC `import_transactions_atomic` no soporta `DIVIDENDO` o `CUPON` de forma nativa en el batch, forzando a `portfolio-engine.ts` a procesarlos individualmente en un loop (líneas 505-516), lo cual es lento.
- **Recommendation:** Extender la migración 010 para soportar tipos de movimientos de solo caja en el importador masivo.

## Summary of Remaining Actions for 10k+ Valuation:
1. **Mover `closed_trades` al RPC:** Es el último eslabón para una atomicidad del 100%.
2. **Sanitizar `rebuildPosition`:** Evitar que pise la `version` del bloqueo optimista.
3. **Auditoría de Clientes Supabase:** Reducir el uso de `service_role` a lo estrictamente necesario (workers).
4. **Incremental Closed Trades:** Dejar de borrar y reinsertar todo el historial por cada venta.
