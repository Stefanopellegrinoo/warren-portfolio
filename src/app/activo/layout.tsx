import AppShell from '@/components/shell/AppShell'

// The menu folds to its icons, as on Gráficos, so the numbers have room (odd/tasks/asset-page.md L24).
export default function ActivoLayout({ children }: { children: React.ReactNode }) {
  return <AppShell iconMenu>{children}</AppShell>
}
