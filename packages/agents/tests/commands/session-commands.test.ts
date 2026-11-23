import { describe, expect, it, vi } from 'vitest'
import { routeCommand, sessionCommands } from '../../src/commands/index.js'

function setup() {
  const h = {
    reset: vi.fn(),
    stop: vi.fn(),
    steer: vi.fn(),
    compact: vi.fn(),
    setModel: vi.fn(),
    setEffort: vi.fn(),
    status: vi.fn(),
  }
  return { h, commands: sessionCommands(h) }
}

// A gateway hook: returns true when it handled the text, false to let it through as a message.
async function gatewayHook(text: string, commands: ReturnType<typeof sessionCommands>) {
  const routed = routeCommand(text.trim(), commands)
  if (routed.kind !== 'command') return false
  await routed.command.run?.(routed.arg, undefined)
  return true
}

describe('sessionCommands', () => {
  it('resets on /new and not on /new chat', async () => {
    const { h, commands } = setup()
    expect(await gatewayHook('/new chat', commands)).toBe(false)
    expect(h.reset).not.toHaveBeenCalled()
    expect(await gatewayHook('  /new ', commands)).toBe(true)
    expect(h.reset).toHaveBeenCalledTimes(1)
  })

  it('runs the same session methods from a hook and a text router', async () => {
    const { h, commands } = setup()
    await gatewayHook('/steer go left', commands)
    await gatewayHook('/model m1', commands)
    const routed = routeCommand('/steer go left', commands)
    if (routed.kind === 'command') await routed.command.run?.(routed.arg, undefined)
    expect(h.steer).toHaveBeenCalledTimes(2)
    expect(h.steer).toHaveBeenCalledWith('go left')
    expect(h.setModel).toHaveBeenCalledWith('m1')
  })

  it('omits commands without a handler', () => {
    expect(sessionCommands({ stop: vi.fn() }).map((c) => c.name)).toEqual(['stop'])
  })
})
