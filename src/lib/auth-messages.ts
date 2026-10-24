import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js'

const NO_CONNECTION = 'No hay conexión. Revisá tu internet y probá de nuevo.'

// Supabase Auth error codes the login and sign-up forms can hit, in the words the user needs.
const BY_CODE: Record<string, string> = {
  invalid_credentials: 'El email o la contraseña no son correctos',
  email_not_confirmed: 'Todavía no confirmaste tu email. Abrí el enlace que te enviamos por correo.',
  user_already_exists: 'Ya hay una cuenta con ese email. Ingresá con tu contraseña.',
  email_exists: 'Ya hay una cuenta con ese email. Ingresá con tu contraseña.',
  weak_password: 'La contraseña es muy débil. Usá una más larga, que combine letras y números.',
  over_request_rate_limit: 'Hubo demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.',
  over_email_send_rate_limit: 'Hubo demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.',
  email_address_invalid: 'Ese email no es válido. Revisalo y probá de nuevo.',
  signup_disabled: 'Por ahora no se pueden crear cuentas nuevas',
}

/** A Spanish message for a failed sign-in or sign-up; never Supabase's English text. */
export function authErrorMessage(err: unknown, mode: 'login' | 'signup'): string {
  // A fetch that never reached the server: supabase-js wraps it, a bare fetch throws TypeError.
  if (isAuthRetryableFetchError(err) || err instanceof TypeError) return NO_CONNECTION
  // Any Supabase auth error with a known code: a weak password arrives as AuthWeakPasswordError, not AuthApiError.
  if (isAuthError(err) && err.code && BY_CODE[err.code]) return BY_CODE[err.code]
  return mode === 'login'
    ? 'No se pudo ingresar. Probá de nuevo en unos minutos.'
    : 'No se pudo crear la cuenta. Probá de nuevo en unos minutos.'
}
