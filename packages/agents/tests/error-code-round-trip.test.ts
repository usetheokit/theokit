import { createWireReader } from '@theokit/presenter'
import { describe, expect, it } from 'vitest'
import { ERROR_CODE_DATA_PART } from '../src/bridge/index.js'
import { presentUIMessageStream } from '../src/bridge/present-ui-message-stream.js'

describe('error code round trip', () => {
  it('exports the part name', () => {
    expect(ERROR_CODE_DATA_PART).toBe('data-error-code')
  })

  it('presentUIMessageStream then createWireReader keeps the code', async () => {
    const source = (async function* () {
      yield { type: 'error', message: 'busy', code: 'session_busy' }
    })()
    const reader = createWireReader()
    const out: unknown[] = []
    for await (const c of presentUIMessageStream(source as never, {
      textId: 't',
      onError: (e) => e.message,
    }))
      out.push(...reader.read(c as never))
    expect(out.filter((e) => (e as { type: string }).type === 'error')).toEqual([
      { type: 'error', message: 'busy', code: 'session_busy' },
    ])
  })
})
