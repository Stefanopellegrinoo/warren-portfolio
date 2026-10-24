'use client'

import './globals.css'
import RouteError from '@/components/shell/RouteError'
import { THEME_BOOT_SCRIPT } from '@/lib/theme'

// Replaces the root layout when the layout itself fails, so it brings its own html, styles and theme.
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <RouteError {...props} fullPage />
      </body>
    </html>
  )
}
