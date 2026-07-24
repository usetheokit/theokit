import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { ConfigurationError } from '../../src/capability/capabilities.js'
import { ToolboxCapability, type ToolDeclaration } from '../../src/capability/toolbox.js'
import { Agent } from '../../src/decorators/agent.js'
import { HumanInTheLoop } from '../../src/decorators/human-in-the-loop.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Tool, Toolbox } from '../../src/decorators/tool.js'

/**
 * M53 — `@Toolbox`/`@Tool` without decorators: the class declares its tools as DATA and the
 * capability takes an instance. Every assertion below compares against the DECORATOR path, because
 * tools are the one place the pipeline does real work (binding a handler to the instance, prefixing
 * the namespace) rather than just moving metadata.
 */
describe('ToolboxCapability ≡ @Toolbox/@Tool', () => {
  const searchInput = z.object({ q: z.string() })

  @Toolbox({ namespace: 'support' })
  class DecoratedTools {
    @Tool({ name: 'search', description: 'Search tickets', input: searchInput })
    async search({ q }: { q: string }): Promise<string> {
      return `found ${q}`
    }
  }

  class PlainTools {
    static readonly tools: ToolDeclaration[] = [
      { name: 'search', description: 'Search tickets', input: searchInput, method: 'search' },
    ]
    async search({ q }: { q: string }): Promise<string> {
      return `found ${q}`
    }
  }

  it('produces the same compiled tool — name, description, schema', () => {
    @Agent({ name: 'a', route: '/a' })
    class DecoratedAgent {
      @MainLoop()
      async run(): Promise<void> {}
    }
    const viaDecorators = compileAgent(
      walkAgentMetadata(DecoratedAgent, [DecoratedTools]),
      new Map([[DecoratedTools, new DecoratedTools()]]),
    )
    const viaCapability = applyCapabilities([
      new ToolboxCapability(new PlainTools(), { namespace: 'support' }),
    ])

    expect(viaCapability.tools).toHaveLength(viaDecorators.tools.length)
    const [a] = viaCapability.tools
    const [b] = viaDecorators.tools
    expect({ name: a.name, description: a.description, inputSchema: a.inputSchema }).toEqual({
      name: b.name,
      description: b.description,
      inputSchema: b.inputSchema,
    })
    expect(a.name).toBe('support.search') // namespace prefix preserved
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
    expect(draft.tools.map((t) => t.name)).toEqual(['x.a', 'y.b'])
  })

  it('a HITL-gated tool lands in the same `hitl` map the decorator path builds', () => {
    @Toolbox({ namespace: 'ops' })
    class DecoratedGated {
      @Tool({ name: 'deploy', description: 'deploy', input: z.object({}) })
      @HumanInTheLoop({ question: 'Deploy?' })
      async deploy(): Promise<string> {
        return 'ok'
      }
    }
    @Agent({ name: 'g', route: '/g' })
    class GatedAgent {
      @MainLoop()
      async run(): Promise<void> {}
    }
    const viaDecorators = compileAgent(
      walkAgentMetadata(GatedAgent, [DecoratedGated]),
      new Map([[DecoratedGated, new DecoratedGated()]]),
    )

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

    expect([...(viaCapability.hitl ?? new Map()).keys()]).toEqual([
      ...(viaDecorators.hitl ?? new Map()).keys(),
    ])
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

  it('a toolbox declaring no tools fails fast', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- fixture: a toolbox declaring nothing
    class Empty {}
    expect(() => new ToolboxCapability(new Empty())).toThrow(/não declara tools/)
  })
})
