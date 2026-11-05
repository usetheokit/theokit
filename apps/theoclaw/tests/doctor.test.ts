import { expect, it } from 'vitest'
import { doctor } from '../src/doctor.js'

it('fails a rejected credential without printing provider secrets', async () => {
  const lines: string[] = []
  const secret = 'broken-secret'
  const code = await doctor({ THEOCLAW_MODEL: 'openrouter/test', OPENROUTER_API_KEY: secret }, (line) => lines.push(line), async () => new Response(secret, { status: 401 }))
  expect(code).toBe(1)
  expect(lines.join('')).not.toContain(secret)
})
