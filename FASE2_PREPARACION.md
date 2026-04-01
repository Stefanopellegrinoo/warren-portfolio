# ⚠️ PREPARACIÓN FASE 2 - Robustez & Concurrencia

**Estado**: 🟡 PENDIENTE (depende de FASE 1)  
**Fecha estimada inicio**: Después de FASE 1 completa  
**Timeline estimado**: 3 días  
**Pre-requisitos**: ✅ FASE 1 completa

## 🎯 OBJETIVOS FASE 2
Eliminar race conditions y garantizar consistencia ACID en operaciones multi-step.

## 📋 TAREAS SEGÚN PLAN ORIGINAL

### 1. Analizar puntos de concurrencia
- Mapear todas las funciones `rebuild*`
- Identificar transacciones SQL que deben ser atómicas

### 2. Implementar transacciones Supabase
```typescript
// Código del plan - NECESITA VERIFICACIÓN
async function processWithTransaction(userId: string, input) {
  const supabase = createServiceClient()
  
  // Iniciar transacción
  const { data, error } = await supabase.rpc('begin_transaction')
  // ...
}
```

### 3. Alternativa: Optimistic Locking
```sql
-- cash_balance con version column
ALTER TABLE cash_balance ADD version INT DEFAULT 1;

-- Upsert con version check
UPDATE cash_balance 
SET balance = :new_balance, version = version + 1
WHERE user_id = :user_id AND version = :expected_version
```

### 4. Patrón: Incremental Update
```typescript
async function processDeposit(userId: string, amount: number) {
  // UPDATE atómico en lugar de rebuild
  await supabase.rpc('increment_cash_balance', {
    p_user_id: userId,
    p_amount: amount
  })
  
  // Solo registrar movimiento
  await supabase.from('cash_movements').insert(...)
}
```

## 🔍 VERIFICACIONES NECESARIAS ANTES DE IMPLEMENTAR

### Críticas:
1. **¿Supabase tiene `rpc('begin_transaction')`?** → Verificar documentación Supabase
2. **¿Optimistic locking es mejor approach?** → Evaluar tradeoffs
3. **¿Incremental update via RPC ya existe?** → Buscar funciones existentes

### Técnicas:
1. **Revisar código actual** para identificar race conditions reales
2. **Analizar tablas** `cash_movements`, `cash_balance`, `on_trades`, etc.
3. **Verificar índices** para performance concurrente

## 📊 DECISIONES ARQUITECTURALES PENDIENTES

### Opción A: Transacciones Supabase
**Pros**: 
- ACID garantizado
- Rollback automático
**Cons**:
- ¿Soporte real en Supabase?
- Complejidad adicional

### Opción B: Optimistic Locking  
**Pros**:
- Simple de implementar
- Bueno para baja contención
**Cons**:
- Retries necesarios en conflictos
- Más lógica en aplicación

### Opción C: Incremental Update
**Pros**:
- Más performante
- Menos reads
**Cons**:
- Solo aplicable a ciertas operaciones
- Requiere stored procedures

## 🎪 PLAN DE ORQUESTRACIÓN

### Secuencia recomendada:
1. **✅ FASE 1 completa** (pre-requisito)
2. **Análisis técnico** de opciones (delegar a `general`)
3. **Decisión arquitectural** con usuario
4. **Implementación** (delegar a `sdd-apply`)
5. **Tests de concurrencia** (múltiples requests simultáneos)

## 📅 TIMELINE ESTIMADO
- Día 1: Análisis y decisión (0.5 días)
- Día 1-2: Implementación solución elegida (1.5 días)  
- Día 3: Tests y verificación (1 día)

## ⚠️ RIESGOS IDENTIFICADOS
1. **Solución incorrecta**: Implementar algo que no resuelve el problema real
2. **Performance impact**: Transacciones pueden ser lentas
3. **Complexity overhead**: Añadir mucha complejidad para poco beneficio

## 📝 PREPARATIVOS
1. Documentar race conditions actuales con ejemplos
2. Investigar capacidades reales de Supabase
3. Preparar tests de concurrencia para validar solución

---
*Preparado por el orquestador mientras espera FASE 1*