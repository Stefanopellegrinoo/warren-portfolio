# Warren Portfolio

Warren Portfolio es un gestor y tracking de portafolio de inversiones multi-activo optimizado para el mercado argentino.

---

## ¿Qué es?
Una plataforma web para centralizar y calcular de forma precisa la rentabilidad, flujos de caja y estado actual de posiciones financieras en **Acciones, CEDEARs, Obligaciones Negociables (ONs)** y **Caja (USD/ARS)**.

---

## Stack Tecnológico

*   **Frontend & UI**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Radix UI (componentes accesibles y estilizados).
*   **Visualización & Gráficos**: `lightweight-charts` (gráficos financieros interactivos de alta performance con soporte para dibujos persistentes en canvas) y `Recharts` (gráficos dinámicos del dashboard).
*   **Base de Datos & Auth**: Supabase (PostgreSQL) con Row Level Security (RLS) activo para aislamiento robusto de datos (multi-tenancy) y Supabase Auth para gestión segura de sesiones mediante cookies HTTP-Only.
*   **Gestión de Tareas & Colas**: BullMQ (motor de colas basado en Redis) para el procesamiento distribuido de actualización de precios e importaciones en segundo plano.
*   **Caché & Base de Datos In-Memory**: Redis (Upstash / Self-hosted) para aceleración del dashboard e invalidación de caché optimizada (estrategias CAS con Scripts Lua integrados).
*   **Testing**: Vitest para pruebas unitarias de algoritmos de negocio e integración de endpoints API.
*   **DevOps & Deployment**: Docker & Docker Compose para empaquetado del frontend y workers de BullMQ, orquestado detrás de Nginx y empaquetado como Progressive Web App (PWA). Incluye health checks de contenedor (`/api/health`, sonda de Redis + Supabase) y reinicio automático de servicios (`restart: unless-stopped`).

---

## ¿Cómo lo hace? (Arquitectura Técnica)
Warren funciona bajo una arquitectura orientada a eventos e integridad de datos:

1. **Cálculo de Costo Promedio Ponderado Móvil (FIFO/Average Cost)**: Implementado de forma cronológica secuencial en [portfolio-engine.ts](file:///home/stefano/proyectos/portfolio/warren-portfolio/src/lib/portfolio-engine.ts) y [on-engine.ts](file:///home/stefano/proyectos/portfolio/warren-portfolio/src/lib/on-engine.ts). Resetea contadores y promedios cuando las posiciones se cierran completamente.
2. **Atomicidad SQL**: Utiliza funciones y RPCs atómicos de PostgreSQL en Supabase (como `process_transaction_atomic` e `import_transactions_atomic`) para garantizar que la inserción de operaciones, movimientos de efectivo e historial ocurran en una única transacción de base de datos sin generar inconsistencias.
3. **Bloqueo Optimista (Concurrency)**: Utiliza un sistema de control de versiones en base de datos para prevenir colisiones o race conditions ante múltiples actualizaciones simultáneas de una misma posición.
4. **Performance & Caching**: Implementa Redis para almacenar caché del resumen del portafolio y estadísticas, con invalidaciones dirigidas e incrementos de versión CAS vía Lua Scripts para evitar lag de datos.
6. **Resiliencia ante fallos**: Degradación elegante cuando Redis no responde — los workers hacen *fail-fast* (reiniciados automáticamente por Docker) y la cotización de ONs recurre a un fallback de precios en base de datos, evitando quedar sin datos.
5. **Procesamiento en Segundo Plano**: Usa colas de BullMQ sobre Redis gestionadas por workers independientes ([price-worker.ts](file:///home/stefano/proyectos/portfolio/warren-portfolio/src/lib/price-worker.ts)) para la actualización programada de cotizaciones (Yahoo Finance) e importaciones masivas.

---

## Funcionalidades Core

### 1. Dashboard Consolidado
*   Muestra KPIs financieros esenciales (Valor del Portfolio, P&L diario y acumulado, saldo en Caja).
*   Visualización de distribución de activos y rendimientos en gráficos e históricos.

### 2. Gráfico Interactivo (Estilo TradingView)
*   Integración de gráficos financieros con persistencia de dibujos del usuario (Líneas de tendencia, Canales paralelos, Retrocesos de Fibonacci, etc.).
*   Alertas de precio en tiempo real con disparadores configurables (Crosses above, Crosses below).

### 3. Módulos de Inversión Específicos
*   **CEDEARs**: Conversión y visualización automática considerando ratios oficiales de conversión de acciones.
*   **Obligaciones Negociables (ONs)**: Soporte completo para renta fija corporativa (moneda MEP/USD), registrando cupones de interés y amortizaciones automáticamente en el flujo de caja.

### 4. Gestor de Estrategias y Setups
*   Permite modelar portafolios teóricos (setups) y comparar su rendimiento histórico proyectado frente a posiciones reales en un panel de comparación avanzado.

### 5. Historial y Flujo de Caja
*   Registro y análisis incremental de operaciones cerradas (`closed_trades`) para ganancias/pérdidas realizadas.
*   Gestor de flujos libres de efectivo en el módulo `cashflow` (depósitos, retiros y cobros de dividendos).

### 6. Importador Masivo (Excel)
*   Soporte asincrónico para subir y parsear archivos `.xlsx` de transacciones en lote de forma segura sin bloquear la interfaz.
