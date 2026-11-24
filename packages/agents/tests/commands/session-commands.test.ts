import { describe, expect, it, vi } from 'vitest'
import { createCommandRegistry, routeCommand, sessionCommands } from '../../src/commands/index.js'

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
    expect(h.steer).toHaveBeenCalledWith('go left', undefined)
    expect(h.setModel).toHaveBeenCalledWith('m1', undefined)
  })

  it('omits commands without a handler', () => {
    expect(sessionCommands({ stop: vi.fn() }).map((c) => c.name)).toEqual(['stop'])
  })
})

describe('sessionCommands with a context', () => {
  it('passes the caller context to the handler', async () => {
    const calls: string[] = []
    const registry = createCommandRegistry(
      sessionCommands<{ id: string }>({
        reset: (ctx) => {
          calls.push(ctx.id)
        },
      }),
    )
    await registry.dispatch('/new', { id: 'a' })
    expect(calls).toEqual(['a'])
  })

  it('adds exactly its command per handler and none when omitted', () => {
    const noop = () => undefined
    const each: [string, string[]][] = [
      ['clear', ['clear']],
      ['retry', ['retry']],
      ['usage', ['usage']],
      ['help', ['help']],
      ['quit', ['quit']],
      ['sessions', ['sessions']],
      ['resume', ['resume']],
      ['fork', ['fork']],
      ['rename', ['rename']],
      ['archive', ['archive']],
      ['delete', ['delete']],
      ['goal', ['goal']],
      ['login', ['login']],
      ['logout', ['logout']],
    ]
    for (const [key, names] of each) {
      const defs = sessionCommands({ [key]: noop })
      expect(defs.map((d) => d.name)).toEqual(names)
    }
    expect(sessionCommands({})).toEqual([])
  })

  it('forwards the argument and context, and routes the exit alias', async () => {
    const seen: unknown[] = []
    const registry = createCommandRegistry(
      sessionCommands<number>({
        resume: (id, ctx) => {
          seen.push([id, ctx])
        },
        quit: (ctx) => {
          seen.push(['quit', ctx])
        },
      }),
    )
    await registry.dispatch('/resume abc', 7)
    await registry.dispatch('/exit', 8)
    expect(seen).toEqual([
      ['abc', 7],
      ['quit', 8],
    ])
  })

  it('routes /STEER x and /status@somebot with the router options', () => {
    const commands = sessionCommands({ steer: () => undefined, status: () => undefined })
    const options = { caseInsensitive: true, stripBotSuffix: true }
    const steer = routeCommand('/STEER x', commands, options)
    const status = routeCommand('/status@somebot', commands, options)
    expect(steer).toMatchObject({ kind: 'command', arg: 'x' })
    expect(steer.kind === 'command' && steer.command.name).toBe('steer')
    expect(status.kind === 'command' && status.command.name).toBe('status')
    expect(routeCommand('/STEER x', commands).kind).toBe('error')
  })
})
