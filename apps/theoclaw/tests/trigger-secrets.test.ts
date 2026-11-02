/**
 * B-397 NFR-003 (AC-006): a trigger secret, an approved hook fingerprint and the body of a refused
 * delivery never reach the process output.
 */
import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startTheoClaw } from '../src/composition.js'
import type { RunningTheoClaw } from '../src/composition.js'
import { capturingStream, fakeBuilders, noAgent, TELEGRAM_AND_LINE, WORKSPACE } from './composition-fixtures.js'
import { FakeAgent, assistant, finished, waitFor } from './fakes.js'

const SECRET = 'S-trigger-secret-marker'
const FINGERPRINT = 'f'.repeat(63) + 'e'
const BODY_MARKER = 'B-refused-body-marker'

const running: RunningTheoClaw[] = []
afterEach(async () => {
  for (const app of running.splice(0)) {
    await app.loop.stopAll()
    await app.close()
  }
})

function post(base: string, body: string, secret: string): Promise<Response> {
  return fetch(`${base}/hooks/ci`, {
    method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
    body,
  })
}

describe('the trigger values in the process output (NFR-003)', () => {
  it('writes 0 occurrences of the secret, the approved fingerprint and the refused body', async () => {
    const capture = capturingStream()
    const { adapters, builders } = fakeBuilders()
    const app = await startTheoClaw({
      cwd: WORKSPACE,
      env: {
        ...TELEGRAM_AND_LINE,
        THEOCLAW_TRIGGERS: 'ci',
        THEOCLAW_TRIGGER_CI_SECRET: SECRET,
        THEOCLAW_TRIGGER_CI_REPLY_TO: 'telegram:42',
        THEOCLAW_APPROVED_HOOKS: FINGERPRINT,
      },
      agentFactory: noAgent,
      // The run echoes the secret and the fingerprint, so a reply or a failure line would carry them.
      triggerAgentFactory: async () =>
        new FakeAgent({ frames: [assistant(`echo ${SECRET} ${FINGERPRINT}`), finished()], result: { status: 'error', error: { code: `${SECRET}-${FINGERPRINT}` } } }),
      builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capture],
    })
    running.push(app)
    await app.loop.ready
    const base = `http://127.0.0.1:${app.address().port}`

    expect((await post(base, BODY_MARKER, 'another-secret-value')).status).toBe(401)
    expect((await post(base, '{"ok":true}', SECRET)).status).toBe(202)
    await waitFor(() => capture.text().includes('trigger ci: run failed'), 5000, 'the run failure line')

    const output = capture.text() + JSON.stringify(adapters.get('telegram')?.sent ?? [])
    expect(output.split(SECRET)).toHaveLength(1)
    expect(capture.text().split(FINGERPRINT)).toHaveLength(1)
    expect(output.split(BODY_MARKER)).toHaveLength(1)
  })
})
