'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useRouter } from 'next/navigation'
import { TrendingUp, Mail, Lock, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess('')
    setLoading(true)
    const sb = createClient()
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.push('/dashboard')
        router.refresh()
      } else {
        const { error } = await sb.auth.signUp({ email, password })
        if (error) throw error
        setSuccess('Revisá tu email para confirmar la cuenta.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de autenticación')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 bg-grid-pattern opacity-30" />
      {/* Glow orbs */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-amber/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-64 h-64 bg-sky/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-sm animate-slide-up">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-amber flex items-center justify-center mb-4 glow-amber">
            <TrendingUp className="w-6 h-6 text-bg-900" strokeWidth={2.5} />
          </div>
          <h1 className="font-display font-800 text-2xl text-white tracking-tight">WARREN</h1>
          <p className="text-slate-500 font-mono text-xs mt-1">PORTFOLIO TRACKER</p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-6 border border-white/10">
          <h2 className="font-display font-700 text-white text-lg mb-1">
            {mode === 'login' ? 'Bienvenido' : 'Crear cuenta'}
          </h2>
          <p className="text-slate-500 font-mono text-xs mb-6">
            {mode === 'login' ? 'Ingresá tus credenciales' : 'Completá los datos para registrarte'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="warren@portfolio.com"
                  className="input-field w-full pl-9" required />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input type={showPass ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field w-full pl-9 pr-9" required />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-rose text-xs font-mono bg-rose/10 rounded-lg px-3 py-2 border border-rose/20">{error}</p>
            )}
            {success && (
              <p className="text-emerald text-xs font-mono bg-emerald/10 rounded-lg px-3 py-2 border border-emerald/20">{success}</p>
            )}

            <button type="submit" disabled={loading}
              className="btn-primary w-full py-2.5 flex items-center justify-center gap-2">
              {loading && <div className="w-4 h-4 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" />}
              {mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
            </button>
          </form>

          <button onClick={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError(''); setSuccess('') }}
            className="w-full text-center text-xs text-slate-500 hover:text-slate-300 font-mono mt-4 transition-colors">
            {mode === 'login' ? '¿No tenés cuenta? Registrate' : '¿Ya tenés cuenta? Ingresá'}
          </button>
        </div>
      </div>
    </div>
  )
}
