/**
 * What the Resumen asks for on a cold load. Its layout preloads them from the HTML, so the browser
 * starts them while the page's JS downloads instead of after it starts; the page's own fetches then
 * reuse those responses. Keep in step with the page (dashboard/__tests__/loads-fast.test.tsx).
 */
export const RESUMEN_FIRST_REQUESTS = [
  '/api/positions',
  '/api/portfolio-history?days=all&universe=total',
  '/api/cash/movements?limit=5&offset=0',
  '/api/cedears',
  '/api/activos',
] as const
