// odd/tasks/ux-base-global.md S2: the login shows Spanish messages for Supabase auth errors.
import { describe, it, expect } from 'vitest'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { authErrorMessage } from '@/lib/auth-messages'

const apiError = (message: string, status: number, code: string) => new AuthApiError(message, status, code)

describe('authErrorMessage', () => {
  it.each([
    ['Invalid login credentials', 400, 'invalid_credentials', 'El email o la contraseña no son correctos'],
    ['Email not confirmed', 400, 'email_not_confirmed', 'Todavía no confirmaste tu email. Abrí el enlace que te enviamos por correo.'],
    ['User already registered', 422, 'user_already_exists', 'Ya hay una cuenta con ese email. Ingresá con tu contraseña.'],
    ['Password should be at least 6 characters', 422, 'weak_password', 'La contraseña es muy débil. Usá una más larga, que combine letras y números.'],
    ['Request rate limit reached', 429, 'over_request_rate_limit', 'Hubo demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.'],
    ['Unable to validate email address: invalid format', 400, 'email_address_invalid', 'Ese email no es válido. Revisalo y probá de nuevo.'],
  ])('translates %j', (message, status, code, expected) => {
    expect(authErrorMessage(apiError(message, status, code), 'login')).toBe(expected)
  })

  it('says there is no connection when the request never reached the server', () => {
    expect(authErrorMessage(new AuthRetryableFetchError('Failed to fetch', 0), 'login'))
      .toBe('No hay conexión. Revisá tu internet y probá de nuevo.')
    expect(authErrorMessage(new TypeError('Failed to fetch'), 'login'))
      .toBe('No hay conexión. Revisá tu internet y probá de nuevo.')
  })

  it('never shows an unknown English message', () => {
    expect(authErrorMessage(apiError('Something odd happened', 500, 'unexpected_failure'), 'login'))
      .toBe('No se pudo ingresar. Probá de nuevo en unos minutos.')
    expect(authErrorMessage(apiError('Something odd happened', 500, 'unexpected_failure'), 'signup'))
      .toBe('No se pudo crear la cuenta. Probá de nuevo en unos minutos.')
  })
})
