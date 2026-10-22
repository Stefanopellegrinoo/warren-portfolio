# Rediseño de la interfaz: base visual, navegación y Resumen

Fecha: 2026-10-21. Estado: aprobado el estilo y el menú, pendiente aprobar este documento.

## Por qué

El usuario siente que la app "parece hecha con IA" y quiere algo "más sobrio, profesional, accesible, que no queme los ojos". El relevamiento del 2026-10-21 lo confirma:

- **Efectos decorativos:** vidrio esmerilado (80 usos de `glass`), brillos ámbar, ruido de fondo y orbes difuminados en el login.
- **Títulos y etiquetas:** títulos con una palabra resaltada en color ("Portfolio **Overview**") y unas 340 etiquetas de 9 a 11 px en mayúsculas monoespaciadas.
- **Tres lenguajes visuales:** Warren (vidrio y ámbar), Trading (copia de TradingView, con su propia navegación) y ONs.
- **Pesos de fuente rotos:** 140 clases `font-600`, `font-700` y `font-800` no existen en Tailwind 3, así que no hacen nada.
- **Accesibilidad:**
  - Botones de ícono sin nombre accesible.
  - Labels sin asociar a su campo (9 de 73).
  - Sin foco visible.
  - Texto con contraste de 2,9:1.
  - Ganancia y pérdida distinguidas solo por color.
  - Sin `prefers-reduced-motion`.
- **Repeticiones:** el valor y el P&L aparecen en tres páginas, hay 7 estilos de pestañas y 3 de tarjetas KPI.
- **Barra inferior del celular:** tiene 8 botones de 64 px y se sale de la pantalla.

El usuario usa la app todos los días, mucho en el celular, y la pantalla que más usa es la principal. **El responsive es un requisito, no un detalle.** Lo pidió dos veces.

## Qué cubre este documento

El primero de tres proyectos, en este orden:

1. **Base visual y navegación** (este documento): tokens, tipografía, componentes base, la nueva estructura del menú y el armazón de la app (barra lateral, menú en celular).
2. **Resumen** (este documento): la pantalla principal rediseñada sobre esa base. Es la primera pantalla que se construye con el sistema nuevo y sirve para probarlo.
3. **Gráficos (hoy Trading)**: proyecto aparte, todavía sin diseñar. Primero hay que encontrar por qué "tarda mucho en cargar y los dibujos y alertas andan muy mal", y después rediseñarlo.

Las demás páginas (Operaciones, Rendimiento, ONs, Estrategias, Gastos) se rediseñan después, de a una, con esta misma base.

## Objetivos

- Que toda pantalla tocada adopte el estilo aprobado, descrito abajo.
- Que el menú quede como el aprobado.
- Que el Resumen se vea y funcione como el boceto aprobado, con datos reales.
- Que sea accesible, con el nivel de WCAG 2.2 AA como meta:
  - Contraste medido.
  - Foco visible.
  - Nombres accesibles en todos los controles.
  - Labels asociados.
  - Ganancia y pérdida con signo además de color.
  - Objetivos táctiles de 44 px en celular.
  - Respeto de `prefers-reduced-motion`.
- Que sea responsive sin desplazamiento horizontal en ningún ancho entre 320 y 1920 px.

## No objetivos

- No se rediseñan todavía Gráficos/Trading, Operaciones, Rendimiento, ONs, Estrategias ni Gastos. Solo cambian de lugar en el menú y heredan el armazón nuevo.
- No cambia ningún cálculo, endpoint ni dato. Es solo interfaz.
- No se arregla en este proyecto la diferencia entre el "Valor total cartera" de Estadísticas (US$ 19.050, solo caja) y el del Dashboard (US$ 39.951). Queda anotada como defecto aparte.

## Anti-objetivos (sería un fracaso aunque funcione)

- Cualquier rastro del estilo viejo en lo que se toque: vidrio, brillos, degradés decorativos, ruido de fondo, palabras resaltadas en títulos, animaciones de entrada escalonadas.
- Contenido metido en tarjetas redondeadas idénticas. La jerarquía sale del peso de la letra y de líneas finas.
- Una pantalla que se ve bien en escritorio y se rompe en el celular.
- Mezclar el sistema nuevo con el viejo dentro de la misma pantalla.

## El estilo aprobado

**Referencia:** la "Dirección A, precisión tranquila" del artefacto https://claude.ai/artifact/PWNZL9HyNZiU3KK8ML4H92 (archivos `direccion-a/tokens.css` y `direccion-a/shell.css`). El usuario rechazó tres propuestas propias antes de señalar esta. **No hay que reinterpretarla: hay que copiarla.**

El boceto aprobado del Resumen está en `docs/superpowers/specs/assets/2026-10-21-resumen-mockup.html`. Tiene esos dos archivos incrustados tal cual, más los estilos propios de la pantalla. Es la fuente de verdad visual. El usuario lo aprobó con "si perfecto".

Lo esencial:

- **Colores:**
  - Grises cálidos: fondo `#faf9f7`, barra lateral `#f2f0ec`, líneas `#e4e1db`.
  - Tinta `#1c1a17` con dos grises secundarios.
  - Acento único verde petróleo (`#0b6b64`).
  - Acción primaria en tinta.
  - Estados (peligro, aviso, info, ok, neutro), cada uno con color de texto, fondo suave y punto.
  - Tema oscuro cálido (`#161513`) con todos los valores redefinidos.
- **Tema:** claro, oscuro o automático (sigue al sistema). El automático es el predeterminado. El selector va en la barra lateral.
- **Tipografía:**
  - Títulos de página y el valor total en Newsreader (serif, peso 400).
  - Toda la interfaz en IBM Plex Sans 400/500/600.
  - IBM Plex Mono solo para atajos de teclado.
  - Cifras tabulares en toda la app.
  - Base de 14 px, con la escala del archivo de tokens (12, 13, 14, 16, 20, 24, 32).
- **Estructura:**
  - Espaciado en múltiplos de 4.
  - Radios de 4, 6 y 8 px.
  - Sombras solo en lo que flota (popovers, toasts).
  - Las secciones son un título de 16 px semibold con una línea fina debajo, y filas separadas por líneas.
- **Chips de estado:** siempre punto más texto, nunca solo color.
- **Números:** formato argentino (`39.951,80`, `−1,69 %`), con signo explícito en resultados y variaciones. El usuario lo aceptó al aprobar el boceto. Hoy la app usa formato de EE. UU.

## Menú (aprobado)

```
Warren                       [Buscar activo  Ctrl K]
  Resumen                    ← /dashboard
  Gráficos                   ← /trading
  Operaciones                ← /history (Historial)
  Rendimiento                ← /statistics (Estadísticas)
  Obligaciones negociables   ← /ons y sus subpáginas
  Estrategias y alertas      ← /strategies
MIS ACTIVOS
  DUK 12,1 %, SPG 10,3 %, ...  (los 5 de mayor peso + "Ver los N")
PERSONAL
  Gastos                     ← /cashflow
──────────
[Claro | Oscuro | Auto]
Usuario, Cerrar sesión
```

- Cada ticker de "Mis activos" abre Gráficos con ese activo.
- Las subpáginas de ONs (mi cartera, carteras de prueba, ficha de una ON) marcan "Obligaciones negociables" como activo en el menú.
- **Escritorio (≥ 820 px):** barra lateral fija de 264 px, sticky y con scroll propio.
- **Celular y tablet (< 820 px):** barra superior de 56 px con botón de menú y nombre. La barra lateral se abre como panel deslizable con fondo oscurecido. Se cierra con Escape, con la X o tocando afuera. Se elimina la barra inferior de 8 botones.
- Gráficos/Trading hoy tiene su propio armazón de pantalla completa. En este proyecto solo tiene que poder volver al menú nuevo. Su rediseño es el proyecto 3.

## Resumen (pantalla principal)

Tal como el boceto, de arriba abajo:

1. **Encabezado:**
   - Título "Tu cartera".
   - Fecha y estado del mercado ("Mercado cerrado, precios al cierre" o el equivalente en vivo).
   - Botones "Importar" (secundario) y "Nueva operación" (primario). Abren los mismos flujos que hoy.
2. **Aviso de conciliación:** cuando hay diferencias de saldos, mismo dato que el `ReconciliationBanner` actual. Va en estilo de aviso, con el link "Revisar diferencias".
3. **Dos columnas** (3:2) en escritorio, una sola columna por debajo de 1080 px.

   **Columna izquierda:**
   - **Valor de la cartera:**
     - Total en serif con el resultado del día al lado.
     - Debajo, resultado abierto (con %), resultado realizado y capital invertido.
     - Selector de período 1M/3M/6M/1A/Todo.
     - Gráfico de línea del valor, con línea punteada del capital invertido. Al pasar el mouse muestra fecha, valor y resultado sobre lo invertido. Con el gráfico enfocado, las flechas recorren los días.
   - **Tenencias:** filas agrupadas en "Acciones y CEDEARs", "Caja" y "Obligaciones negociables". Cada posición muestra:
     - Ticker, que abre Gráficos.
     - Nombre.
     - Cantidad y peso en la cartera.
     - Chip con la variación de hoy.
     - Valor y resultado acumulado (monto y %).
     
     Caja muestra el saldo y "Ajustar saldo". Sin ONs, una línea "No tenés ONs" con link a explorarlas. "Ver como tabla" lleva a la vista de tabla completa: la tabla actual con ordenamiento y la acción de vender, reestilizada.

   **Columna derecha:**
   - **Para revisar:** posiciones fuera de lo normal. Criterio por defecto (decisión mía): pérdida acumulada de 30 % o más, y la mayor caída del día si supera el 3 %. Cada fila con un chip y una frase que explica por qué está ahí. Si no hay nada, la sección no se muestra.
   - **Distribución:** barras por clase de activo con su porcentaje.
   - **Últimos movimientos:** los 4 más recientes con fecha, detalle e importe con signo, y "Ver todos" hacia Operaciones.
4. **Pie:** fuente y hora de las cotizaciones.

**Celular:**
- Una columna, en el orden de arriba.
- Botones del encabezado al ancho completo, de 44 px.
- Gráfico de 180 px.
- En cada tenencia el chip baja debajo del nombre y el valor queda a la derecha.
- En "Distribución" la barra baja a su propia línea.

**Estados que tiene que contemplar:**
- Cargando: filas esqueleto como en la referencia.
- Sin posiciones: una invitación a cargar la primera operación.
- Error al traer cotizaciones: aviso con reintentar.
- Activos sin precio: el `UnpricedNotice` actual, reestilizado.
- Mercado en vivo: el auto-refresco actual sigue igual. Solo cambia cómo se muestra.

## Restricciones

- **Stack actual:** Next 14 App Router, Tailwind 3.3, React 18. Los primitivos de `src/components/ui` (base-ui con sintaxis de Tailwind 4 y tokens shadcn sin definir) hoy están rotos. O se arreglan contra los tokens nuevos, o se dejan sin usar en lo que se toque.
- **Fuentes:** con `next/font/google`, en reemplazo de Syne y JetBrains Mono.
- **Tokens:** como variables CSS, como en `tokens.css`, expuestas a Tailwind por `theme.extend`. Los colores viejos (`bg.*`, `amber`, `tv.*`, etc.) quedan mientras otras páginas los usen. No se borran en este proyecto.
- **Sin cambios en datos:** no tocar API, cálculos ni base de datos.
- **Verificación responsive obligatoria** antes de dar algo por terminado:
  - Medir con Playwright en 320, 360, 390, 600, 761, 900, 1024, 1180, 1280, 1440 y 1920 px que `document.documentElement.scrollWidth` sea igual al ancho.
  - Mirar capturas de celular, tablet y escritorio, en claro y oscuro.
- **Verificación con datos reales** en la app corriendo, con la cuenta del usuario. Solo lectura.

## Decidido por el usuario

- Estilo: la Dirección A, sin reinterpretar ("si perfecto" sobre el boceto v4).
- Menú: el de arriba ("si").
- Prioridades: Resumen y Gráficos son los dos pilares. Gráficos va en un proyecto aparte, primero investigando las fallas.
- El responsive es crítico.

## Decidido por mí (revisalas)

- Tema automático como predeterminado, igual que la referencia.
- Criterio de "Para revisar": −30 % acumulado o la mayor caída del día si supera −3 %.
- "Mis activos" muestra los 5 de mayor peso.
- En celular, panel deslizable en vez de barra inferior, como en la referencia y en el boceto aprobado.
- Las rutas mantienen sus URLs actuales en este proyecto. Solo cambian nombres y lugar en el menú.
- **Páginas todavía no rediseñadas:** mientras una página siga con el estilo viejo, fuerza el tema oscuro (`data-theme="dark"`), barra lateral incluida, para no tener una barra clara al lado de contenido oscuro. El selector de tema solo tiene efecto en las pantallas ya rediseñadas. Hoy esa es solo el Resumen. Cada página que se rediseña pasa a respetar el tema elegido.
- **"Buscar activo" (Ctrl K) entra en este proyecto, en versión mínima.**
  - Es un diálogo accesible: foco atrapado, Escape cierra, flechas y Enter eligen.
  - Busca en los activos que tenés y en la lista de `/api/activos` (ticker y nombre). `/api/tickers` no existe.
  - Elegir un resultado abre Gráficos con ese ticker (`/trading?symbol=X`, un parámetro que hay que agregar).
  - Las ONs quedan fuera del buscador por ahora: sus posiciones no guardan el ISIN y la búsqueda de ONs tampoco lo devuelve.
  - Funciona desde cualquier página que tenga el armazón.
- **Gráfico del Resumen:**
  - Usa el universo `measurable` (acciones y caja) de `/api/portfolio-history`, el mismo que usa hoy Estadísticas. Así comprar una ON no aparece como pérdida.
  - Debajo del gráfico, una línea en texto secundario dice qué incluye ("Acciones y caja. Las ONs no tienen historia todavía.").
  - Si el período muestra puntos estimados, la misma línea lo aclara, con la información del `ProvenanceNote` actual adaptada al estilo nuevo.
- **Formato de números argentino en toda la app:** se cambia en el helper compartido (`formatUSD` y afines en `src/lib/utils.ts`) y se actualizan sus tests. Es un cambio de presentación, y que el mismo monto se lea distinto según la página sería peor.
- **Gráficos/Trading:** sigue a pantalla completa, sin la barra lateral, para no quitarle ancho al gráfico. Su barra superior suma un acceso para volver al menú (el logo lleva al Resumen) y se le aplica el tema oscuro nuevo solo a ese armazón. En este proyecto `/trading` no tiene que pasar la verificación de 11 anchos. Eso es parte del proyecto 3.
- **ONs en Tenencias:**
  - El ticker abre `/ons/mi-cartera`, no Gráficos. Las posiciones de ON no guardan el ISIN, así que no se puede armar el link a `/ons/[isin]`.
  - La cantidad se muestra como VN (cantidad × 100), igual que en los arreglos recientes.
  - El resto de la fila es igual al de una acción: chip de hoy si hay cotización propia, valor y resultado.
  - Si una ON no tiene cotización propia, en vez del chip va uno neutro "Sin precio hoy".

- **Nombres de empresa** en Tenencias: salen de `/api/activos` (`ticker`, `nombre`). Si un ticker no está, se muestra solo el ticker.
- **Diálogos existentes** ("Nueva operación", "Importar"): se siguen usando los actuales sin rediseñar. Se rediseñan junto con Operaciones. Es una excepción conocida al anti-objetivo de no mezclar estilos.
- **"Ver como tabla"** muestra, dentro del Resumen, una tabla nueva con el estilo nuevo: columnas ordenables y el botón Vender. La vista de lotes de la tabla vieja se pierde en esta etapa y vuelve con el rediseño de Operaciones.
- **Movimientos de caja:** el Resumen conserva la acción de borrar un movimiento y "Ajustar saldo", con un diálogo nuevo que reutiliza `buildAdjustPayload`, para no perder lo que hoy hace `CashSection`.

## Queda en manos de quien construye

- Cómo partir los componentes y en qué carpetas.
- Cómo mapear los tokens a Tailwind.
- Si los primitivos `ui/*` se arreglan o se reemplazan.
- Cómo se implementa el gráfico del Resumen. Puede seguir con recharts o pasar a SVG propio, siempre que se vea y responda como el boceto.
