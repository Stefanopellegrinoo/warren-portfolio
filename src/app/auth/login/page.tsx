'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useRouter } from 'next/navigation'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { authErrorMessage } from '@/lib/auth-messages'
import { safeNextPath } from '@/lib/login-redirect'

type SearchParams = { next?: string | string[]; motivo?: string | string[] }

export default function LoginPage({ searchParams = {} }: { searchParams?: SearchParams }) {
  const next = typeof searchParams.next === 'string' ? searchParams.next : null
  const sessionExpired = searchParams.motivo === 'sesion'
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
        router.push(safeNextPath(next, window.location.origin))
        router.refresh()
      } else {
        const { error } = await sb.auth.signUp({ email, password })
        if (error) throw error
        setSuccess('Revisá tu email para confirmar la cuenta.')
      }
    } catch (err) {
      setError(authErrorMessage(err, mode))
    } finally {
      setLoading(false)
    }
  }

  const field =
    'h-10 w-full rounded border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 focus:border-ring focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:h-11'

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 text-ink">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center font-serif text-2xl">Warren</p>

        <div className="rounded-md border border-line bg-surface p-6">
          <h1 className="font-serif text-xl">{mode === 'login' ? 'Ingresar' : 'Crear cuenta'}</h1>
          <p className="mb-6 mt-1 text-sm text-ink-2">
            {mode === 'login' ? 'Ingresá con tu email y contraseña.' : 'Completá los datos para registrarte.'}
          </p>

          {sessionExpired && mode === 'login' && (
            <p role="status" className="mb-4 rounded bg-info-soft px-3 py-2 text-sm text-info">
              Tu sesión venció. Ingresá de nuevo para seguir donde estabas.
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <input id="login-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                  className={field} required />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium">Contraseña</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <input id="login-password" type={showPass ? 'text' : 'password'} value={password}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  onChange={e => setPassword(e.target.value)}
                  className={`${field} pr-11`} required />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 max-[819px]:right-0 max-[819px]:h-11 max-[819px]:w-11 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  {showPass ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
            )}
            {success && (
              <p role="status" className="rounded bg-ok-soft px-3 py-2 text-sm text-ok">{success}</p>
            )}

            <button type="submit" disabled={loading}
              className="flex h-10 w-full items-center justify-center gap-2 rounded bg-primary text-sm font-medium text-primary-on hover:bg-primary-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-[819px]:h-11">
              {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />}
              {mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
            </button>
          </form>

          <button type="button" onClick={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError(''); setSuccess('') }}
            className="mt-4 w-full rounded py-2 text-center max-[819px]:min-h-11 text-sm text-accent-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {mode === 'login' ? '¿No tenés cuenta? Registrate' : '¿Ya tenés cuenta? Ingresá'}
          </button>
        </div>
      </div>
    </main>
  )
}
