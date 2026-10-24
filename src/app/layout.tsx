import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Mono, Newsreader } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { THEME_BOOT_SCRIPT } from '@/lib/theme'
import AppStatus from '@/components/shell/AppStatus'

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600'],
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
})

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['400', '500'],
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#161513' },
  ],
}

export const metadata: Metadata = {
  title: 'Warren · Portfolio',
  description: 'Tu cartera de inversiones: cuánto tenés, cómo te va hoy, tus ONs, operaciones y gráficos.',
  manifest: '/manifest.json',
  // iOS turns long numbers (amounts, quantities) into phone links unless told not to.
  formatDetection: { telephone: false, date: false, email: false, address: false },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Warren',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    // Opaque and square: iOS rounds the corners itself and paints transparent pixels black.
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">
        {children}
        <Toaster
          // Bottom: on a phone a lasting notice (offline) must not cover the menu button in the header.
          position="bottom-right"
          theme="system"
          toastOptions={{
            classNames: {
              toast: 'bg-surface text-ink border border-line rounded-lg shadow-toast font-sans',
              title: 'text-sm font-medium',
              description: 'text-sm text-ink-3',
              success: '[&_[data-icon]]:text-ok',
              error: '[&_[data-icon]]:text-danger',
              warning: '[&_[data-icon]]:text-warn',
              info: '[&_[data-icon]]:text-info',
              // Sonner fixes buttons at 24px; on phones they need the 44px touch target.
              actionButton: 'bg-primary text-primary-on font-medium rounded-md !h-8 !px-3 max-[819px]:!h-11',
              cancelButton: 'bg-surface-2 text-ink-2 font-medium rounded-md !h-8 !px-3 max-[819px]:!h-11',
              closeButton: 'text-ink-3 hover:text-ink',
            },
          }}
        />
        <AppStatus />
      </body>
    </html>
  )
}
