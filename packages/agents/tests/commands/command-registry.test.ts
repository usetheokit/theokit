import { describe, expect, it } from 'vitest'

import { CommandRegistryError, createCommandRegistry } from '../../src/commands/index.js'
import { defineCommand } from '../../src/commands/command-router.js'

describe('createCommandRegistry', () => {
  it('an alias routes to its canonical definition', () => {
    const registry = createCommandRegistry([
      defineCommand({ name: 'quit', description: 'leave', aliases: ['exit'] }),
    ])
    const routed = registry.route('/exit')
    expect(routed.kind).toBe('command')
    if (routed.kind === 'command') expect(routed.command.name).toBe('quit')
  })

  it('palette lists visible canonical names only', () => {
    const registry = createCommandRegistry([
      defineCommand({ name: 'quit', description: 'leave', aliases: ['exit'] }),
      defineCommand({ name: 'secret', description: 'x', hidden: true }),
      defineCommand({ name: 'help', description: 'help' }),
    ])
    expect(registry.palette()).toEqual([
      { name: 'quit', description: 'leave' },
      { name: 'help', description: 'help' },
    ])
  })

  it('a hidden command still routes', () => {
    const registry = createCommandRegistry([
      defineCommand({ name: 'secret', description: 'x', hidden: true }),
    ])
    expect(registry.route('/secret').kind).toBe('command')
  })

  it('dispatch calls run with the argument and context', async () => {
    const calls: [string, { id: number }][] = []
    const registry = createCommandRegistry<{ id: number }>([
      defineCommand<{ id: number }>({
        name: 'model',
        description: 'm',
        aliases: ['m'],
        run: (arg, ctx) => {
          calls.push([arg, ctx])
        },
      }),
    ])
    const routed = await registry.dispatch('/m gpt', { id: 7 })
    expect(routed.kind).toBe('command')
    expect(calls).toEqual([['gpt', { id: 7 }]])
    await registry.dispatch('plain text', { id: 8 })
    expect(calls).toHaveLength(1)
  })

  it('two definitions claiming the same alias throw CommandRegistryError naming both', () => {
    const build = (): unknown =>
      createCommandRegistry([
        defineCommand({ name: 'quit', description: 'a', aliases: ['x'] }),
        defineCommand({ name: 'exit', description: 'b', aliases: ['x'] }),
      ])
    expect(build).toThrow(CommandRegistryError)
    expect(build).toThrow(/"quit".*"exit"/)
  })

  it('two definitions with the same name throw CommandRegistryError', () => {
    expect(() =>
      createCommandRegistry([
        defineCommand({ name: 'a', description: '' }),
        defineCommand({ name: 'a', description: '' }),
      ]),
    ).toThrow(CommandRegistryError)
  })

  it('arg none still refuses an argument through an alias', () => {
    const registry = createCommandRegistry([
      defineCommand({ name: 'clear', description: 'c', arg: 'none', aliases: ['cls'] }),
    ])
    expect(registry.route('/cls now')).toEqual({
      kind: 'error',
      reason: 'unexpected-argument',
      input: '/cls now',
    })
  })
})
