import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Reflector } from '@theokit/http'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { Sandbox, getSandboxConfig, isPathAllowed, isCommandAllowed } from '../../src/decorators/sandbox.js'
import { EditFormat } from '../../src/decorators/edit-format.js'
import { ProjectContext, getProjectContextConfig } from '../../src/decorators/project-context.js'
import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'

const reflector = new Reflector()

// ─── @Sandbox ───────────────────────────────────────────────

describe('@Sandbox decorator', () => {
  it('test_sandbox_stores_full_config', () => {
    @Agent({ name: 'coder', route: '/coder' })
    @Sandbox({
      filesystem: {
        read: ['src/**', 'tests/**', 'package.json'],
        write: ['src/**', 'tests/**'],
        deny: ['node_modules/**', '.env', '*.key'],
      },
      commands: {
        allow: ['npm test', 'tsc --noEmit', 'git diff'],
        deny: ['rm -rf', 'git push --force'],
      },
      network: false,
    })
    class CoderAgent {
      @MainLoop()
      async run() {}
    }

    const config = getSandboxConfig(CoderAgent)!
    expect(config.filesystem!.read).toEqual(['src/**', 'tests/**', 'package.json'])
    expect(config.filesystem!.deny).toContain('.env')
    expect(config.commands!.allow).toContain('npm test')
    expect(config.commands!.deny).toContain('rm -rf')
    expect(config.network).toBe(false)
  })

  it('test_sandbox_defaults', () => {
    @Agent({ name: 'test', route: '/test' })
    @Sandbox({})
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getSandboxConfig(TestAgent)!
    expect(config.network).toBe(true)
    expect(config.commandTimeout).toBe(120_000)
  })

  it('test_no_sandbox_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getSandboxConfig(TestAgent)).toBeUndefined()
  })
})

describe('isPathAllowed', () => {
  const sandbox = {
    filesystem: {
      read: ['src/**', 'package.json'],
      write: ['src/**'],
      deny: ['src/secrets/**', '.env'],
    },
  }

  it('test_allowed_read', () => {
    expect(isPathAllowed(sandbox, 'src/index.ts', 'read')).toBe(true)
    expect(isPathAllowed(sandbox, 'package.json', 'read')).toBe(true)
  })

  it('test_denied_path_overrides_allow', () => {
    expect(isPathAllowed(sandbox, 'src/secrets/key.pem', 'read')).toBe(false)
    expect(isPathAllowed(sandbox, 'src/secrets/key.pem', 'write')).toBe(false)
    expect(isPathAllowed(sandbox, '.env', 'read')).toBe(false)
  })

  it('test_write_not_allowed_outside_src', () => {
    expect(isPathAllowed(sandbox, 'docs/readme.md', 'write')).toBe(false)
  })

  it('test_read_not_allowed_outside_patterns', () => {
    expect(isPathAllowed(sandbox, 'scripts/deploy.sh', 'read')).toBe(false)
  })

  it('test_no_filesystem_allows_all', () => {
    expect(isPathAllowed({}, 'anything.ts', 'read')).toBe(true)
    expect(isPathAllowed({}, 'anything.ts', 'write')).toBe(true)
  })

  it('test_glob_star_matches_single_level', () => {
    expect(isPathAllowed({ filesystem: { read: ['*.json'] } }, 'package.json', 'read')).toBe(true)
    expect(isPathAllowed({ filesystem: { read: ['*.json'] } }, 'src/foo.json', 'read')).toBe(false)
  })

  it('test_glob_doublestar_matches_deep', () => {
    expect(isPathAllowed({ filesystem: { read: ['src/**'] } }, 'src/a/b/c.ts', 'read')).toBe(true)
  })
})

describe('isCommandAllowed', () => {
  const sandbox = {
    commands: {
      allow: ['npm test', 'npm run build', 'tsc', 'git diff', 'git status'],
      deny: ['rm -rf', 'git push --force', 'npm publish'],
    },
  }

  it('test_allowed_commands', () => {
    expect(isCommandAllowed(sandbox, 'npm test')).toBe(true)
    expect(isCommandAllowed(sandbox, 'npm test --watch')).toBe(true)
    expect(isCommandAllowed(sandbox, 'tsc --noEmit')).toBe(true)
    expect(isCommandAllowed(sandbox, 'git diff HEAD~1')).toBe(true)
  })

  it('test_denied_commands', () => {
    expect(isCommandAllowed(sandbox, 'rm -rf /')).toBe(false)
    expect(isCommandAllowed(sandbox, 'git push --force')).toBe(false)
    expect(isCommandAllowed(sandbox, 'npm publish')).toBe(false)
  })

  it('test_unlisted_command_denied', () => {
    expect(isCommandAllowed(sandbox, 'curl http://evil.com')).toBe(false)
  })

  it('test_no_commands_allows_all', () => {
    expect(isCommandAllowed({}, 'anything')).toBe(true)
  })
})

// ─── @EditFormat ────────────────────────────────────────────

describe('@EditFormat decorator', () => {
  it('test_edit_format_on_tool', () => {
    @Toolbox({ namespace: 'editor' })
    class EditorTools {
      @Tool({ name: 'edit', description: 'Edit', input: z.object({}) })
      @EditFormat('search-replace')
      async edit() { return '' }

      @Tool({ name: 'write', description: 'Write', input: z.object({}) })
      @EditFormat('full-file')
      async write() { return '' }

      @Tool({ name: 'patch', description: 'Patch', input: z.object({}) })
      @EditFormat('unified-diff')
      async patch() { return '' }
    }

    expect(reflector.get(EditFormat, EditorTools, 'edit')).toBe('search-replace')
    expect(reflector.get(EditFormat, EditorTools, 'write')).toBe('full-file')
    expect(reflector.get(EditFormat, EditorTools, 'patch')).toBe('unified-diff')
  })

  it('test_no_edit_format_returns_undefined', () => {
    @Toolbox()
    class Tools {
      @Tool({ name: 'search', description: 'Search', input: z.object({}) })
      async search() { return '' }
    }

    expect(reflector.get(EditFormat, Tools, 'search')).toBeUndefined()
  })
})

// ─── @ProjectContext ────────────────────────────────────────

describe('@ProjectContext decorator', () => {
  it('test_project_context_stores_config', () => {
    @Agent({ name: 'coder', route: '/coder' })
    @ProjectContext({
      rootMarkers: ['package.json'],
      indexStrategy: 'tree-sitter',
      maxFilesInContext: 30,
      relevanceStrategy: 'import-graph',
      ignorePatterns: ['node_modules', 'dist'],
      includeExtensions: ['.ts', '.tsx', '.js'],
    })
    class CoderAgent {
      @MainLoop()
      async run() {}
    }

    const config = getProjectContextConfig(CoderAgent)!
    expect(config.indexStrategy).toBe('tree-sitter')
    expect(config.maxFilesInContext).toBe(30)
    expect(config.relevanceStrategy).toBe('import-graph')
    expect(config.includeExtensions).toEqual(['.ts', '.tsx', '.js'])
  })

  it('test_project_context_defaults', () => {
    @Agent({ name: 'test', route: '/test' })
    @ProjectContext()
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getProjectContextConfig(TestAgent)!
    expect(config.rootMarkers).toContain('package.json')
    expect(config.rootMarkers).toContain('go.mod')
    expect(config.indexStrategy).toBe('regex')
    expect(config.maxFilesInContext).toBe(20)
    expect(config.relevanceStrategy).toBe('git-history')
    expect(config.ignorePatterns).toContain('node_modules')
  })

  it('test_no_project_context_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getProjectContextConfig(TestAgent)).toBeUndefined()
  })
})

// ─── File Edit Stream Event ─────────────────────────────────

describe('FileEditEvent stream type', () => {
  it('test_search_replace_event', () => {
    const event: AgentStreamEvent = {
      type: 'file_edit',
      file: 'src/app.ts',
      format: 'search-replace',
      search: 'const x = 1',
      replace: 'const x = 2',
    }
    expect(event.type).toBe('file_edit')
  })

  it('test_full_file_event', () => {
    const event: AgentStreamEvent = {
      type: 'file_edit',
      file: 'src/new-file.ts',
      format: 'full-file',
      content: 'export const hello = "world"',
    }
    expect(event.type).toBe('file_edit')
  })

  it('test_unified_diff_event', () => {
    const event: AgentStreamEvent = {
      type: 'file_edit',
      file: 'src/app.ts',
      format: 'unified-diff',
      diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
    }
    expect(event.type).toBe('file_edit')
  })

  it('test_all_14_event_types', () => {
    const events: AgentStreamEvent[] = [
      { type: 'run_started', runId: 'r', agentName: 'a' },
      { type: 'text_delta', content: '' },
      { type: 'tool_call', callId: 'c', toolName: 't', input: {} },
      { type: 'tool_result', callId: 'c', toolName: 't', output: '', durationMs: 0, isError: false },
      { type: 'thinking', content: '' },
      { type: 'iteration', step: 1, totalSteps: null },
      { type: 'approval_required', callId: 'c', toolName: 't', question: 'q', callbackUrl: 'u', timeoutMs: 0 },
      { type: 'artifact_start', artifactId: 'a', mimeType: 'm' },
      { type: 'artifact_chunk', artifactId: 'a', chunk: '', isLast: true },
      { type: 'state_update', channel: 'c', data: {} },
      { type: 'checkpoint_saved', checkpointId: 'c', step: 0, resumeToken: 't' },
      { type: 'file_edit', file: 'f', format: 'full-file', content: '' },
      { type: 'error', code: 'E', message: 'm', retryable: false },
      { type: 'done', result: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0 },
    ]
    expect(events).toHaveLength(14)
    expect(new Set(events.map(e => e.type)).size).toBe(14)
  })
})

// ─── Full Code Assistant Example ────────────────────────────

describe('Full code assistant integration', () => {
  it('test_complete_code_assistant_agent', () => {
    @Agent({ name: 'theo-code', route: '/api/agents/code', model: 'claude-opus-4-6', systemPrompt: 'You are a code assistant.' })
    @Sandbox({
      filesystem: { read: ['**'], write: ['src/**', 'tests/**'], deny: ['.env', '*.key'] },
      commands: { allow: ['npm test', 'tsc', 'git diff'], deny: ['rm -rf'] },
      network: false,
    })
    @ProjectContext({ indexStrategy: 'tree-sitter', relevanceStrategy: 'import-graph', maxFilesInContext: 25 })
    class TheoCodeAgent {
      @MainLoop({ strategy: 'react', maxIterations: 20 })
      async run() {}
    }

    @Toolbox({ namespace: 'fs' })
    class FileSystemTools {
      @Tool({ name: 'read', description: 'Read file', input: z.object({ path: z.string() }) })
      async read() { return '' }

      @Tool({ name: 'edit', description: 'Edit file', input: z.object({}) })
      @EditFormat('search-replace')
      async edit() { return '' }

      @Tool({ name: 'write', description: 'Write file', input: z.object({}) })
      @EditFormat('full-file')
      async write() { return '' }
    }

    // All metadata accessible
    const sandbox = getSandboxConfig(TheoCodeAgent)!
    expect(sandbox.network).toBe(false)
    expect(isPathAllowed(sandbox, 'src/app.ts', 'write')).toBe(true)
    expect(isPathAllowed(sandbox, '.env', 'read')).toBe(false)
    expect(isCommandAllowed(sandbox, 'npm test')).toBe(true)
    expect(isCommandAllowed(sandbox, 'rm -rf /')).toBe(false)

    const project = getProjectContextConfig(TheoCodeAgent)!
    expect(project.indexStrategy).toBe('tree-sitter')

    expect(reflector.get(EditFormat, FileSystemTools, 'edit')).toBe('search-replace')
    expect(reflector.get(EditFormat, FileSystemTools, 'write')).toBe('full-file')
  })
})
