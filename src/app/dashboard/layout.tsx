import { preload } from 'react-dom'
import AppShell from '@/components/shell/AppShell'
import { RESUMEN_FIRST_REQUESTS } from '@/lib/resumen/first-requests'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // crossOrigin 'anonymous' matches a plain same-origin fetch() (cookies sent), so the page reuses them.
  for (const url of RESUMEN_FIRST_REQUESTS) preload(url, { as: 'fetch', crossOrigin: 'anonymous' })
  return <AppShell>{children}</AppShell>
}
