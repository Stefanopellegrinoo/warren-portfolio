// odd/tasks/ux-paginas.md S1: a request that never reached the server never shows the browser's "Failed to fetch".
import { describe, it, expect } from 'vitest'
import { NO_CONNECTION, requestErrorMessage } from '@/lib/request-errors'

describe('requestErrorMessage', () => {
  it('says there is no connection when fetch itself failed', () => {
    expect(requestErrorMessage(new TypeError('Failed to fetch'), 'No se pudo borrar')).toBe(NO_CONNECTION)
    expect(NO_CONNECTION).toBe('No hay conexión. Revisá tu internet y probá de nuevo.')
  })

  it('keeps the message the app threw (the server already answers in Spanish)', () => {
    expect(requestErrorMessage(new Error('El gasto no existe'), 'No se pudo borrar')).toBe('El gasto no existe')
  })

  // Native review advisory R3-abort-english-leak: an aborted fetch carries the browser's English text.
  it('falls back for an aborted request instead of the browser\'s English message', () => {
    // In browsers the AbortError DOMException is an Error; Node's is not, so build the browser's shape.
    const aborted = Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' })
    expect(requestErrorMessage(aborted, 'No se pudo guardar')).toBe('No se pudo guardar')
  })

  it('falls back when the body was not JSON or there is no message', () => {
    expect(requestErrorMessage(new SyntaxError('Unexpected token < in JSON'), 'No se pudo borrar')).toBe('No se pudo borrar')
    expect(requestErrorMessage(new Error(''), 'No se pudo borrar')).toBe('No se pudo borrar')
    expect(requestErrorMessage('boom', 'No se pudo borrar')).toBe('No se pudo borrar')
  })
})
