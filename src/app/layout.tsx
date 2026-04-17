import type { Metadata, Viewport } from 'next'
import { Syne, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '600', '700', '800'],
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#0f172a',
}

export const metadata: Metadata = {
  title: 'Warren · Portfolio',
  description: 'Investment portfolio tracker',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Warren',
  },
  icons: {
    icon: [
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${syne.variable} ${jetbrains.variable}`}>
      <body className="bg-bg-900 text-white antialiased">
        {children}
        <Toaster
          richColors
          position="top-right"
          theme="dark"
          className="glass"
          toastOptions={{
            classNames: {
              toast: "group glass border border-white/10 rounded-2xl",
              title: "font-display font-700 text-base",
              description: "font-mono text-sm text-slate-400",
              icon: "text-primary-500",
              success: "bg-gradient-to-br from-emerald-900/30 to-emerald-800/20",
              error: "bg-gradient-to-br from-rose-900/30 to-rose-800/20",
              info: "bg-gradient-to-br from-blue-900/30 to-blue-800/20",
              warning: "bg-gradient-to-br from-amber-900/30 to-amber-800/20",
              loading: "bg-gradient-to-br from-slate-900/30 to-slate-800/20",
              closeButton: "text-slate-500 hover:text-slate-300 transition-colors",
              actionButton: "bg-primary-500 hover:bg-primary-600 text-white font-600 px-3 py-1.5 rounded-lg",
              cancelButton: "bg-slate-800 hover:bg-slate-700 text-slate-300 font-600 px-3 py-1.5 rounded-lg",
            }
          }}
        />
      </body>
    </html>
  )
}
