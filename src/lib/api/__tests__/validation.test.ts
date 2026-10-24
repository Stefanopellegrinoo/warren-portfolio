// odd/tasks/ux-paginas.md S7, verifier A5: every route that reads its body with validateRequest
// (/api/cash, /api/cash/adjust, /api/on-positions) answers a body that is not JSON with a 400.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { INVALID_JSON, validateRequest } from '@/lib/api/validation'

const schema = z.object({ amount: z.number() })
const post = (body?: string) => new Request('http://localhost/api/x', { method: 'POST', body })

describe('validateRequest', () => {
  it.each([['{"amount": '], ['hola'], [''], [undefined]])('a body that is not JSON (%j) is a 400 with INVALID_JSON', async (body) => {
    await expect(validateRequest(schema, post(body))).rejects.toEqual({ status: 400, message: INVALID_JSON, errors: [{ message: INVALID_JSON }] })
  })

  it('a JSON body still goes through the schema', async () => {
    await expect(validateRequest(schema, post('{"amount": 5}'))).resolves.toEqual({ amount: 5 })
    await expect(validateRequest(schema, post('{"amount": "5"}'))).rejects.toMatchObject({ status: 400 })
  })
})
