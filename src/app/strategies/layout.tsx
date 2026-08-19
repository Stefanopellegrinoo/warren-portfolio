import Sidebar from '@/components/layout/Sidebar'

export default function StrategiesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
