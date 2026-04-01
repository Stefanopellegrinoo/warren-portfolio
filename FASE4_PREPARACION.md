# 🧪 PREPARACIÓN FASE 4 - Testing Automatizado

**Estado**: 🟡 PENDIENTE (puede correr paralelo a FASE 2-3)  
**Pre-requisitos**: ✅ FASE 1 (Zod) ayuda mucho  
**Timeline estimado**: 5 días  
**Estrategia**: Setup progresivo de testing pyramid

## 🎯 OBJETIVOS FASE 4
Cobertura >80% en lógica financiera crítica con enfoque en:
1. **Unit tests** para engines y utilities
2. **Integration tests** para endpoints API  
3. **Concurrency tests** para race conditions

## 🏗️ SETUP DE INFRAESTRUCTURA

### 1. Herramientas (según plan original)
```bash
npm install -D jest @testing-library/react @testing-library/jest-dom ts-jest
npm install -D @types/jest supertest
npm install -D jest-environment-jsdom
```

### 2. Configuración Jest
- `jest.config.js` para TypeScript
- Scripts en `package.json`: `"test": "jest", "test:watch": "jest --watch"`
- Setup para mocks de Supabase y Redis

### 3. Test Database (opcional)
Para integration tests reales:
- Supabase Local (docker)
- O usar mocks completos (más simple)

## 📊 PRIORIDADES DE TESTING

### ALTA PRIORIDAD (Core Financial Logic)
1. **`cash-engine.ts`** - `processCashMovement`, `rebuildCashBalance`
2. **`on-engine.ts`** - `processONTransaction`, `rebuildONPosition`
3. **`portfolio-engine.ts`** - `processTransaction`, `rebuildPosition`
4. **Validación Zod** - Schemas y error handling

### MEDIA PRIORIDAD (API Endpoints)  
1. **POST endpoints** con validación (`/api/cash`, `/api/on-positions`, `/api/transactions`)
2. **GET endpoints** con query params
3. **DELETE endpoints** con autorización

### BAJA PRIORIDAD (UI/UX)
1. Componentes React
2. Formularios y validación frontend

## 🧪 ESTRATEGIA DE TESTS

### Unit Tests (aislados)
- **Mock Supabase cliente** completamente
- **Mock Redis** 
- **Test pura lógica de negocio**
- **Cobertura**: edge cases, error paths

### Integration Tests (semi-reales)
- **Supabase Local** o mocks más realistas
- **Test endpoints** con `supertest`
- **Verificar** persistencia real en DB

### Concurrency Tests (especial para FASE 2)
- **Test optimistic locking** con múltiples requests simulados
- **Verificar** que no hay race conditions
- **Medir** performance bajo carga

## 📈 MÉTRICAS DE ÉXITO

### Cobertura (>80% en lógica crítica)
- `cash-engine.ts`: 85%+
- `on-engine.ts`: 85%+  
- `portfolio-engine.ts`: 85%+
- `validation.ts`: 90%+
- **Total proyecto**: >60% aceptable

### Calidad de Tests
- **Cada test** tiene clear `describe` + `it`
- **Setup/teardown** apropiado
- **Mocks** mantenibles y consistentes
- **Edge cases** cubiertos

### Integración CI/CD
- **Tests corren** en CI automáticamente
- **Coverage reporting** en PRs
- **Fail fast** en regresiones

## ⚠️ RIESGOS Y MITIGACIONES

| Riesgo | Mitigación |
|--------|------------|
| Tests frágiles (dependen de mocks complejos) | Usar factories y fixtures reusables |
| Integration tests lentos | Separar en suites: unit (rápido) vs integration (lento) |
| Mock de Supabase incompleto | Empezar con unit tests simples, luego agregar integration |
| Coverage artificial alto (tests triviales) | Enfocar en lógica de negocio, no en getters/setters |

## 🎪 PLAN DE ORQUESTRACIÓN

### Paralelo con FASE 2-3
1. **Setup infraestructura** (Día 1) - puede hacerse ya
2. **Unit tests para Zod** (Día 2) - aprovecha FASE 1
3. **Unit tests para engines** (Día 3) - mientras FASE 2 corre
4. **Integration tests endpoints** (Día 4) 
5. **Concurrency tests** (Día 5) - valida FASE 2

### Dependencias
- **Requiere**: FASE 1 (Zod) para tests de validación
- **Beneficia de**: FASE 2 (Optimistic Locking) para tests de concurrencia
- **Independiente de**: FASE 3 (Performance) y FASE 5 (Monitoring)

## 📅 TIMELINE SUGERIDO
- **Día 1**: Setup Jest + primeros tests Zod
- **Día 2**: Unit tests engines básicos
- **Día 3**: Tests optimistas locking (si FASE 2 lista)
- **Día 4**: Integration tests endpoints
- **Día 5**: Coverage reporting + CI integration

---
*Preparado por el orquestador mientras FASE 2 se ejecuta*