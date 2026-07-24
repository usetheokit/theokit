import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { applyCapabilities } from '../../src/capability/capability.js'
import { ConfigurationError } from '../../src/errors.js'
import { ToolboxCapability, type ToolDeclaration } from '../../src/capability/toolbox.js'

/**
 * M53 — `@Toolbox`/`@Tool` without decorators: the class declares its tools as DATA and the
 * capability takes an instance. Every assertion below compares against the DECORATOR path, because
 * tools are the one place the pipeline does real work: binding a handler to the instance and
 * prefixing the namespace.
 */
describe('ToolboxCapability', () => {
  const searchInput = z.object({ q: z.string() })

  class PlainTools {
    static readonly tools: ToolDeclaration[] = [
      { name: 'search', description: 'Search tickets', input: searchInput, method: 'search' },
    ]
    async search({ q }: { q: string }): Promise<string> {
      return `found ${q}`
    }
  }

  it('compiles a tool with the name (namespace-prefixed), description and schema', () => {
    const { tools } = applyCapabilities([
      new ToolboxCapability(new PlainTools(), { namespace: 'support' }),
    ])
    expect(tools).toHaveLength(1)
    const [tool] = tools
    expect({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }).toEqual({
      name: 'support_search', // namespace prefix preserved
      description: 'Search tickets',
      inputSchema: searchInput,
    })
  })

  it('the handler stays bound to the instance (so a toolbox can hold state)', async () => {
    class StatefulTools {
      static readonly tools: ToolDeclaration[] = [
        { name: 'greet', description: 'greet', input: z.object({}), method: 'greet' },
      ]
      readonly who = 'world'
      async greet(): Promise<string> {
        return `hello ${this.who}`
      }
    }
    const [tool] = applyCapabilities([new ToolboxCapability(new StatefulTools())]).tools
    await expect(tool.handler({})).resolves.toBe('hello world')
  })

  it('several toolboxes ACCUMULATE, as several @Toolbox classes did', () => {
    class A {
      static readonly tools: ToolDeclaration[] = [
        { name: 'a', description: 'a', input: z.object({}), method: 'a' },
      ]
      async a(): Promise<string> {
        return 'a'
      }
    }
    class B {
      static readonly tools: ToolDeclaration[] = [
        { name: 'b', description: 'b', input: z.object({}), method: 'b' },
      ]
      async b(): Promise<string> {
        return 'b'
      }
    }
    const draft = applyCapabilities([
      new ToolboxCapability(new A(), { namespace: 'x' }),
      new ToolboxCapability(new B(), { namespace: 'y' }),
    ])
    expect(draft.tools.map((t) => t.name)).toEqual(['x_a', 'y_b'])
  })

  it('a HITL-gated tool lands in the `hitl` map keyed `<namespace>_<tool>`', () => {
    class PlainGated {
      static readonly tools: ToolDeclaration[] = [
        {
          name: 'deploy',
          description: 'deploy',
          input: z.object({}),
          method: 'deploy',
          hitl: { question: 'Deploy?' },
        },
      ]
      async deploy(): Promise<string> {
        return 'ok'
      }
    }
    const viaCapability = applyCapabilities([
      new ToolboxCapability(new PlainGated(), { namespace: 'ops' }),
    ])

    expect([...(viaCapability.hitl ?? new Map()).keys()]).toEqual(['ops_deploy'])
    expect(viaCapability.hitl?.get('ops_deploy')).toMatchObject({ question: 'Deploy?' })
  })

  it('a typo in `method` fails at AUTHORING time, not when the model calls the tool', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- fixture: a toolbox whose method is missing
    class Broken {
      static readonly tools: ToolDeclaration[] = [
        { name: 't', description: 't', input: z.object({}), method: 'doesNotExist' },
      ]
    }
    expect(() => new ToolboxCapability(new Broken())).toThrow(ConfigurationError)
  })

  /**
   * M55 — the tool name and its HITL gate key must be derived from ONE structure, not built twice.
   * They were built twice before, and that is exactly how they drifted apart in #145: the tool
   * became `ns_tool` while its gate stayed `ns.tool`, silently ungating the tool.
   */
  describe('one derivation, two consumers (M55)', () => {
    class MixedTools {
      static readonly tools: ToolDeclaration[] = [
        { name: 'read', description: 'Read', input: z.object({}), method: 'read' },
        {
          name: 'deploy',
          description: 'Deploy',
          input: z.object({}),
          method: 'deploy',
          hitl: { question: 'Confirm?' },
        },
      ]
      read(): string {
        return 'r'
      }
      deploy(): string {
        return 'd'
      }
    }

    class ReadOnlyTools {
      static readonly tools: ToolDeclaration[] = [
        { name: 'list', description: 'List', input: z.object({}), method: 'list' },
      ]
      list(): string {
        return 'l'
      }
    }

    it('gates ONLY the gated tools, and every gate key exists as a compiled tool', () => {
      const compiled = applyCapabilities([
        new ToolboxCapability(new MixedTools(), { namespace: 'ops' }),
      ])
      const names = compiled.tools.map((t) => t.name)
      expect(names).toEqual(['ops_read', 'ops_deploy'])
      expect([...(compiled.hitl ?? new Map()).keys()]).toEqual(['ops_deploy'])
      // Inclusion, not equality: a gate keyed to a tool that does not exist is the #145 failure.
      for (const key of compiled.hitl?.keys() ?? []) expect(names).toContain(key)
    })

    it('the compiled handlers stay BOUND to the instance through `apply()`', () => {
      // M55 added this against a public `compile()`; M56 deleted that method (zero callers), so the
      // assertion moved to the one remaining path. The binding half is what matters: names alone
      // would still be right if the instance map were lost — only calling the handler proves it.
      const { tools } = applyCapabilities([
        new ToolboxCapability(new MixedTools(), { namespace: 'ops' }),
      ])
      expect(tools.map((t) => t.name)).toEqual(['ops_read', 'ops_deploy'])
      expect(tools[0]?.handler({})).toBe('r')
      expect(tools[1]?.handler({})).toBe('d')
    })

    it('a missing instance and a non-method handler fail as TYPED errors (M56)', async () => {
      // These two throw sites were bare `Error` until M56, inconsistent with the ConfigurationError
      // the same module throws for name validation (`rules/error-handling.md` § 2).
      const { compileTools } = await import('../../src/bridge/agent-compiler.js')
      const token = MixedTools as unknown as Parameters<typeof compileTools>[0][0]['class']
      const walk = {
        class: token,
        namespace: 'ops',
        guards: [],
        tools: [
          {
            propertyKey: 'read',
            config: MixedTools.tools[0]!,
            guards: [],
            trace: false,
            audit: false,
          },
        ],
      }

      expect(() => compileTools([walk], new Map())).toThrow(ConfigurationError)
      expect(() => compileTools([walk], new Map())).toThrow(/não foi instanciado/)

      const noMethod = { ...walk, tools: [{ ...walk.tools[0]!, propertyKey: 'missing' }] }
      expect(() => compileTools([noMethod], new Map([[token, new MixedTools()]]))).toThrow(
        ConfigurationError,
      )
      expect(() => compileTools([noMethod], new Map([[token, new MixedTools()]]))).toThrow(
        /não é um método/,
      )
    })

    it('a toolbox with NO gated tool leaves `hitl` undefined', () => {
      // Load-bearing: `agent-compiler.ts` documents that an empty map ⇒ no gated tools ⇒ the
      // non-HITL stream path (M2, byte-unchanged). Creating an empty Map here would flip that
      // branch for every agent that has no HITL at all.
      const compiled = applyCapabilities([
        new ToolboxCapability(new ReadOnlyTools(), { namespace: 'ro' }),
      ])
      expect(compiled.hitl).toBeUndefined()
    })

    it('two toolboxes merge their gates without overwriting each other', () => {
      const compiled = applyCapabilities([
        new ToolboxCapability(new MixedTools(), { namespace: 'ops' }),
        new ToolboxCapability(new MixedTools(), { namespace: 'infra' }),
      ])
      expect([...(compiled.hitl ?? new Map()).keys()]).toEqual(['ops_deploy', 'infra_deploy'])
      expect(compiled.tools.map((t) => t.name)).toEqual([
        'ops_read',
        'ops_deploy',
        'infra_read',
        'infra_deploy',
      ])
    })
  })

  it('a toolbox declaring no tools fails fast', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- fixture: a toolbox declaring nothing
    class Empty {}
    expect(() => new ToolboxCapability(new Empty())).toThrow(/não declara tools/)
  })
})
