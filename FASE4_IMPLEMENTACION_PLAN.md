# 🧪 PLAN DE IMPLEMENTACIÓN FASE 4 - Testing

**Estado**: 🟡 LISTO PARA LANZAR (paralelo a FASE 3)  
**Timeline**: 5 días  
**Pre-requisitos**: ✅ FASE 1 (Zod) ayuda  
**Beneficia de**: ✅ FASE 2 (Optimistic Locking) para tests de concurrencia

## 🎯 OBJETIVO FINAL
Cobertura >80% en lógica financiera crítica con testing pyramid completo.

## 🏗️ INFRAESTRUCTURA (Día 1)

### 1. Instalar dependencias
```bash
npm install -D jest @types/jest ts-jest jest-environment-jsdom
npm install -D @testing-library/react @testing-library/jest-dom
npm install -D supertest @types/supertest
```

### 2. Configurar Jest
`jest.config.js`:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
}
```

### 3. Scripts en package.json
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage"
  }
}
```

## 🧪 TESTS UNITARIOS (Día 2-3)

### Prioridad 1: Schemas Zod
`src/lib/schemas/__tests__/cash.test.ts`:
```typescript
describe('CashMovementSchema', () => {
  it('validates correct deposit', () => { ... })
  it('rejects negative amount', () => { ... })
  it('requires date format YYYY-MM-DD', () => { ... })
})
```

### Prioridad 2: Engines (con mocks)
`src/lib/__tests__/cash-engine.test.ts`:
- Mock Supabase client completamente
- Test `processCashMovement` lógica de negocio
- Test `rebuildCashBalance` cálculos

### Prioridad 3: Concurrency Helper
`src/lib/__tests__/concurrency.test.ts`:
- Test `updateWithOptimisticLock` retry logic
- Test conflict scenarios
- Test fallback to rebuild functions

## 🔗 TESTS DE INTEGRACIÓN (Día 4)

### Endpoints API con supertest
`src/app/api/__tests__/cash.test.ts`:
```typescript
describe('GET /api/cash/movements', () => {
  it('returns paginated movements', async () => {
    const response = await request(app).get('/api/cash/movements?page=1&limit=10')
    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('pagination')
  })
})
```

### Schema validation integration
Test que endpoints rechazan inputs inválidos según Zod schemas.

## ⚡ TESTS DE CONCURRENCIA (Día 5)

### Optimistic Locking bajo carga
`src/lib/__tests__/concurrency-load.test.ts`:
- Simular múltiples requests simultáneos
- Verificar que todos succeed (con retries)
- Medir performance improvement vs rebuild

### Race condition scenarios
Test específicos para edge cases identificados en análisis.

## 📊 COBERTURA Y REPORTING

### Coverage goals por módulo:
- `cash-engine.ts`: 85%+
- `on-engine.ts`: 85%+  
- `portfolio-engine.ts`: 85%+
- `validation.ts`: 90%+
- `concurrency.ts`: 80%+

### Coverage reporting:
- HTML report en `coverage/` directory
- CI integration (GitHub Actions o similar)
- Fail PR si coverage baja

## 🚀 STRATEGY DE IMPLEMENTACIÓN INCREMENTAL

### Fase 1: Setup + Schemas (Día 1)
- Infraestructura básica
- Tests más fáciles (Zod schemas)

### Fase 2: Unit Tests Core (Día 2-3)  
- Engines con mocks completos
- Concurrency helper

### Fase 3: Integration Tests (Día 4)
- Endpoints API
- Pagination testing

### Fase 4: Load & Concurrency (Día 5)
- Tests de performance
- Validación optimizaciones FASE 3

## ⚠️ RIESGOS Y MITIGACIONES

### Riesgo: Mock complexity
**Mitigación**: Crear factory functions reusables para test data.

### Riesgo: Integration tests lentos
**Mitigación**: Separar en suites (`npm run test:unit` vs `npm run test:integration`).

### Riesgo: False sense of security (mocks muy simples)
**Mitigación**: Incluir algunos tests de integración REALES con Supabase local.

## 📅 TIMELINE PARALELO CON FASE 3

| Día | FASE 3 (Performance) | FASE 4 (Testing) |
|-----|----------------------|------------------|
| 1   | Benchmarking + Índices | Setup Jest + Zod tests |
| 2   | Paginación endpoints | Unit tests engines |
| 3   | Cache Redis | Concurrency tests |
| 4   | Materialized Views (opcional) | Integration tests |
| 5   | Verificación final | Load tests + reporting |

## 🎯 CRITERIOS DE COMPLETACIÓN
- [ ] Jest configurado y corriendo
- [ ] >80% coverage en módulos críticos
- [ ] Tests unitarios para todas las funciones públicas
- [ ] Tests de integración para endpoints principales
- [ ] Tests de concurrencia para optimistic locking
- [ ] CI integration funcionando

---
*Preparado para lanzamiento paralelo con FASE 3*