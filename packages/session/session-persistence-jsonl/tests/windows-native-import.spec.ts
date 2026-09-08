import { describe, expect, it, vi } from 'vitest'

vi.mock('fs-ext', () => {
  throw new Error('fs-ext must not load while importing the Windows lease implementation')
})

describe.skipIf(process.platform !== 'win32')('Windows JSONL lease import', () => {
  it('does not load the POSIX native addon during module evaluation', async () => {
    await expect(import('../src/lease.ts')).resolves.toHaveProperty('SessionWriteLease')
  })
})
