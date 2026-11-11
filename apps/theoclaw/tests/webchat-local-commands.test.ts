import { describe, expect, it, vi } from 'vitest'

import type { TurnRunner } from '../src/control-plane/turn.js'
import { localReply, withLocalCommands } from '../src/webchat/local-commands.js'

describe('webchat local commands', () => {
  it('answers /model with the model id and runs no turn', async () => {
    const inner = vi.fn<TurnRunner>()
    const events: unknown[] = []
    const outcome = await withLocalCommands(inner, 'anthropic/x-1')('/model', (e) => events.push(e))
    expect(inner).not.toHaveBeenCalled()
    expect(outcome).toEqual({ ok: true })
    expect(events).toEqual([{ type: 'text_delta', content: 'Model: anthropic/x-1' }, { type: 'done' }])
  })
  it('answers /status and passes other text to the turn', async () => {
    expect(localReply('/status', 'm')).toContain('Model: m')
    const inner = vi.fn<TurnRunner>(async () => ({ ok: true }))
    await withLocalCommands(inner, 'm')('hello', () => undefined)
    expect(inner).toHaveBeenCalledOnce()
  })
})
