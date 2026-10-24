'use client'

import RouteError from '@/components/shell/RouteError'

// Pages outside the app shell (login); every section has its own boundary inside the menu.
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} fullPage />
}
