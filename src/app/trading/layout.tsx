export default function TradingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-tv-bg">
      {children}
    </div>
  )
}
