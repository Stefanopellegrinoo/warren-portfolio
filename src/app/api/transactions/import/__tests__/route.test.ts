// T2 (odd/tasks/security-hardening.md S2): an upload over 5 MB is rejected before it is parsed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const read = vi.fn()
const addImportJob = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: async () => ({ supabase: {}, user: { id: 'me' } }), isAuthFailure: (r: any) => 'error' in r }))
vi.mock('@/lib/queue', () => ({ addImportJob: (...a: unknown[]) => addImportJob(...a), QueueUnavailableError: class extends Error {} }))
vi.mock('xlsx', () => ({ read: (...a: unknown[]) => read(...a), utils: { sheet_to_json: () => [] } }))

const { POST } = await import('../route')

const upload = (bytes: number) => {
  const fd = new FormData()
  fd.append('file', new File([new Uint8Array(bytes)], 'registro.xlsx'))
  return POST({
    url: 'http://test.local/api/transactions/import',
    headers: new Headers({ 'content-type': 'multipart/form-data; boundary=x' }),
    formData: async () => fd,
  } as never)
}

beforeEach(() => {
  read.mockReset()
  addImportJob.mockReset()
})

describe('POST /api/transactions/import (file upload)', () => {
  it('rejects a file over 5 MB with 413 without parsing it or queueing a job', async () => {
    const res = await upload(5 * 1024 * 1024 + 1)

    expect(res.status).toBe(413)
    expect(read).not.toHaveBeenCalled()
    expect(addImportJob).not.toHaveBeenCalled()
  })

  it('still parses a file at the limit', async () => {
    read.mockReturnValue({ SheetNames: ['Registro'], Sheets: { Registro: {} } })

    await upload(5 * 1024 * 1024)

    expect(read).toHaveBeenCalledOnce()
  })
})

// T5 (L4 a): the body is refused from its declared size, before anything buffers it.
describe('POST /api/transactions/import (request size)', () => {
  it.each(['multipart/form-data; boundary=x', 'application/json'])(
    'rejects a %s body declared over 6 MB with 413 without reading it',
    async (contentType) => {
      const formData = vi.fn()
      const json = vi.fn()

      const res = await POST({
        url: 'http://test.local/api/transactions/import',
        headers: new Headers({ 'content-type': contentType, 'content-length': String(6 * 1024 * 1024 + 1) }),
        formData,
        json,
      } as never)

      expect(res.status).toBe(413)
      expect(formData).not.toHaveBeenCalled()
      expect(json).not.toHaveBeenCalled()
    },
  )
})
