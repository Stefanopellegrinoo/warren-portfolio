# 📊 TRACKING FASE 1 - Validación Zod

**Estado**: 🟡 EN PROGRESO (sub-agente `shared-chocolate-sheep`)  
**Fecha inicio**: 2026-03-31  
**Timeline estimado**: 2 días  
**Responsable**: Sub-agente `sdd-apply`  
**Orquestador**: Yo

## 🎯 OBJETIVOS FASE 1
1. Instalar Zod
2. Crear schemas para todos los inputs
3. Actualizar endpoints para usar `validateRequest` existente
4. Tests básicos de validación
5. No romper funcionalidad existente

## 📋 CHECKLIST DE ENTREGABLES

### 📦 Instalación
- [ ] `npm install zod @types/zod` ejecutado
- [ ] Dependencias agregadas a package.json

### 📝 Schemas 
- [ ] `src/lib/schemas/cash.schema.ts` creado
- [ ] `src/lib/schemas/on.schema.ts` creado
- [ ] `src/lib/schemas/transaction.schema.ts` creado
- [ ] `src/lib/schemas/common.schema.ts` creado (opcional)
- [ ] Schemas cubren validación business (amount max, fechas regex, etc.)

### 🔧 Endpoints Actualizados
**Total endpoints: ~17** (según `find src/app/api -name "route.ts"`)

- [ ] `/api/cash/route.ts` (POST/GET)
- [ ] `/api/cash/movements/route.ts`
- [ ] `/api/cash/movements/[id]/route.ts`
- [ ] `/api/on-positions/route.ts` (POST/GET)
- [ ] `/api/on-positions/quotes/route.ts`
- [ ] `/api/on-positions/closed/route.ts`
- [ ] `/api/transactions/route.ts` (varios)
- [ ] `/api/portfolio/route.ts` (si aplica)
- [ ] `/api/user/route.ts` (si aplica)

**CRITERIO**: Cada endpoint usa `validateRequest(Schema, request)` en lugar de `request.json()` directo

### 🧪 Tests
- [ ] Tests unitarios para schemas en `src/lib/schemas/__tests__/`
- [ ] Validación positiva (datos correctos pasan)
- [ ] Validación negativa (datos incorrectos fallan)
- [ ] Casos edge cubiertos

### ✅ Verificación Final
- [ ] Compilación TypeScript pasa (`npx tsc --noEmit`)
- [ ] Tests existentes pasan (`npm test`)
- [ ] Endpoints funcionan manualmente

## 📈 PROGRESO ACTUAL
**Sub-agente**: `shared-chocolate-sheep` (sdd-apply)  
**Estado**: Ejecutándose  
**Última actualización**: 2026-03-31

## ⚠️ CORRECCIONES IDENTIFICADAS
1. **Middleware ya existe**: Plan original proponía crear `validateBody`, pero YA EXISTE `validateRequest` en `src/lib/api/validation.ts`
2. **Usar funcionalidad existente**: NO crear duplicados

## 🚨 RIESGOS
| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Schema incompleto | Media | Medio | Revisar todos los campos actualmente aceptados por endpoints |
| Breaking changes | Baja | Alto | Mantener backward compatibility en schemas |
| Performance overhead | Baja | Bajo | Zod parsing es marginal |

## 📅 PRÓXIMOS PASOS
1. **Esperar finalización** de sub-agente
2. **Validar entregables** con checklist
3. **Reportar éxito/fallas** al usuario
4. **Iniciar FASE 2** si todo OK

---
*Actualizado automáticamente por el orquestador*