import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Memory, getMemoryConfig } from '../../src/decorators/memory.js'
import { Skills, getSkillsConfig } from '../../src/decorators/skills.js'
import { MCP, getMcpConfig } from '../../src/decorators/mcp.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { generateAgentManifest } from '../../src/manifest/agent-manifest.js'

// ─── @Memory ─────────────────────────────────────────────────

describe('@Memory decorator', () => {
  it('test_memory_stores_config', () => {
    @Agent({ name: 'test', route: '/test' })
    @Memory({ provider: 'honcho', embeddings: true, fts: true, scope: 'per-tenant' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getMemoryConfig(TestAgent)!
    expect(config.provider).toBe('honcho')
    expect(config.embeddings).toBe(true)
    expect(config.fts).toBe(true)
    expect(config.scope).toBe('per-tenant')
  })

  it('test_memory_defaults', () => {
    @Agent({ name: 'test', route: '/test' })
    @Memory()
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getMemoryConfig(TestAgent)!
    expect(config.provider).toBe('built-in')
    expect(config.embeddings).toBe(false)
    expect(config.fts).toBe(false)
    expect(config.scope).toBe('per-user')
  })

  it('test_no_memory_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getMemoryConfig(TestAgent)).toBeUndefined()
  })

  it('test_memory_with_max_facts', () => {
    @Agent({ name: 'test', route: '/test' })
    @Memory({ maxFacts: 1000 })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getMemoryConfig(TestAgent)!.maxFacts).toBe(1000)
  })
})

// ─── @Skills ─────────────────────────────────────────────────

describe('@Skills decorator', () => {
  it('test_skills_array_shorthand', () => {
    @Agent({ name: 'test', route: '/test' })
    @Skills(['customer-service', 'refund-policy'])
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getSkillsConfig(TestAgent)!
    expect(config.include).toEqual(['customer-service', 'refund-policy'])
    expect(config.autoDiscover).toBe(false)
  })

  it('test_skills_object_form', () => {
    @Agent({ name: 'test', route: '/test' })
    @Skills({ include: ['code-review'], autoDiscover: true })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getSkillsConfig(TestAgent)!
    expect(config.include).toEqual(['code-review'])
    expect(config.autoDiscover).toBe(true)
  })

  it('test_no_skills_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getSkillsConfig(TestAgent)).toBeUndefined()
  })
})

// ─── @MCP ─────────────────────────────────────────────────

describe('@MCP decorator', () => {
  it('test_mcp_stores_servers', () => {
    @Agent({ name: 'dev', route: '/dev' })
    @MCP({
      github: { command: 'npx', args: ['-y', '@mcp/server-github'] },
      filesystem: { command: 'npx', args: ['-y', '@mcp/server-filesystem', '/workspace'] },
    })
    class DevAgent {
      @MainLoop()
      async run() {}
    }

    const config = getMcpConfig(DevAgent)!
    expect(Object.keys(config)).toEqual(['github', 'filesystem'])
    expect(config.github.command).toBe('npx')
    expect(config.github.args).toEqual(['-y', '@mcp/server-github'])
    expect(config.filesystem.args).toContain('/workspace')
  })

  it('test_mcp_with_env_and_cwd', () => {
    @Agent({ name: 'test', route: '/test' })
    @MCP({
      custom: {
        command: './server',
        args: ['--port', '3001'],
        env: { API_KEY: 'secret' },
        cwd: '/opt/mcp',
      },
    })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getMcpConfig(TestAgent)!
    expect(config.custom.env).toEqual({ API_KEY: 'secret' })
    expect(config.custom.cwd).toBe('/opt/mcp')
  })

  it('test_no_mcp_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getMcpConfig(TestAgent)).toBeUndefined()
  })
})

// ─── Walk + Compile + Manifest integration ───────────────

describe('Walk/Compile/Manifest with Memory/Skills/MCP', () => {
  it('test_walk_collects_all_three', () => {
    @Agent({ name: 'full', route: '/full', model: 'claude-opus-4-6' })
    @Memory({ provider: 'supermemory', embeddings: true })
    @Skills(['eng-standards', 'code-review'])
    @MCP({ github: { command: 'npx', args: ['@mcp/github'] } })
    class FullAgent {
      @MainLoop()
      async run() {}
    }

    const result = walkAgentMetadata(FullAgent)
    expect(result.memory!.provider).toBe('supermemory')
    expect(result.skills!.include).toEqual(['eng-standards', 'code-review'])
    expect(result.mcpServers!.github.command).toBe('npx')
  })

  it('test_compile_includes_memory_skills_mcp', () => {
    @Agent({ name: 'full', route: '/full' })
    @Memory({ provider: 'mem0', fts: true })
    @Skills(['customer-service'])
    @MCP({ fs: { command: 'npx', args: ['@mcp/fs'] } })
    class FullAgent {
      @MainLoop()
      async run() {}
    }

    const compiled = compileAgent(walkAgentMetadata(FullAgent))
    // `memory` is a union (MemoryOptions | MemorySettings); only one arm carries `provider`.
    expect(compiled.memory).toMatchObject({ provider: 'mem0' })
    // M8-3: skills now compiles to the SDK's SkillsSettings shape ({ enabled, autoInject }),
    // not the decorator's { include } shape (ADR D4 — Agent.create({ skills }) runtime).
    expect(compiled.skills).toEqual({ enabled: ['customer-service'], autoInject: true })
    expect(compiled.mcpServers!.fs.command).toBe('npx')
  })

  it('test_compile_without_memory_skills_mcp', () => {
    @Agent({ name: 'minimal', route: '/minimal' })
    class MinimalAgent {
      @MainLoop()
      async run() {}
    }

    const compiled = compileAgent(walkAgentMetadata(MinimalAgent))
    expect(compiled.memory).toBeUndefined()
    expect(compiled.skills).toBeUndefined()
    expect(compiled.mcpServers).toBeUndefined()
  })

  it('test_manifest_includes_memory_skills_mcp', () => {
    @Agent({ name: 'full', route: '/full' })
    @Memory({ provider: 'honcho', embeddings: true, fts: false, scope: 'per-tenant' })
    @Skills(['a', 'b', 'c'])
    @MCP({
      github: { command: 'npx', args: ['@mcp/github'] },
      slack: { command: 'npx', args: ['@mcp/slack'] },
    })
    class FullAgent {
      @MainLoop()
      async run() {}
    }

    const manifest = generateAgentManifest([walkAgentMetadata(FullAgent)])
    const agent = manifest.agents[0]

    expect(agent.memory).toEqual({
      provider: 'honcho',
      embeddings: true,
      fts: false,
      scope: 'per-tenant',
    })
    expect(agent.skills).toEqual(['a', 'b', 'c'])
    expect(agent.mcpServers).toEqual(['github', 'slack'])
  })

  it('test_manifest_without_optional_decorators', () => {
    @Agent({ name: 'plain', route: '/plain' })
    class PlainAgent {
      @MainLoop()
      async run() {}
    }

    const manifest = generateAgentManifest([walkAgentMetadata(PlainAgent)])
    expect(manifest.agents[0].memory).toBeUndefined()
    expect(manifest.agents[0].skills).toBeUndefined()
    expect(manifest.agents[0].mcpServers).toBeUndefined()
  })
})
