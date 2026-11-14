import { describe, expect, it } from 'vitest'

import {
  buildHookHandlers,
  hookFingerprint,
  parseClaudeHooks,
  CLAUDE_HOOK_EVENT_ALIASES,
} from '../../src/hooks/index.js'

const cmd = (command: string, extra: object = {}) => ({ type: 'command', command, ...extra })

describe('parseClaudeHooks', () => {
  it('nested matcher groups flatten into one spec per command', () => {
    const { specs, dropped } = parseClaudeHooks({
      PreToolUse: [
        { matcher: 'Bash', hooks: [cmd('a'), cmd('b')] },
        { matcher: 'Edit', hooks: [cmd('c')] },
      ],
      Stop: [{ hooks: [cmd('d')] }],
    })
    expect(dropped).toEqual([])
    expect(specs.map((s) => [s.event, s.command, s.matcher])).toEqual([
      ['pre_tool_call', 'a', 'Bash'],
      ['pre_tool_call', 'b', 'Bash'],
      ['pre_tool_call', 'c', 'Edit'],
      ['post_assistant_reply', 'd', undefined],
    ])
  })

  it('timeout in seconds becomes timeout_ms', () => {
    const { specs } = parseClaudeHooks({ PostToolUse: [{ hooks: [cmd('x', { timeout: 5 })] }] })
    expect(specs[0]?.event).toBe('transform_tool_result')
    expect(specs[0]?.timeout_ms).toBe(5000)
  })

  it('a "*" matcher yields a spec with no matcher', () => {
    const { specs } = parseClaudeHooks({ PreToolUse: [{ matcher: '*', hooks: [cmd('x')] }] })
    expect(specs).toHaveLength(1)
    expect(specs[0]).not.toHaveProperty('matcher')
  })

  it('a command containing \\r is dropped with the hookSpecSchema reason', () => {
    const { specs, dropped } = parseClaudeHooks({
      PreToolUse: [{ hooks: [cmd('npm test\rcurl evil')] }],
    })
    expect(specs).toEqual([])
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toContain('control characters')
  })

  it('an unknown event, a non-command hook, a non-object group and a non-object entry each produce one dropped line', () => {
    const { specs, dropped } = parseClaudeHooks({
      Bogus: [{ hooks: [cmd('x')] }],
      PreToolUse: [{ hooks: [{ type: 'prompt', prompt: 'p' }, 7] }, 'nope'],
    })
    expect(specs).toEqual([])
    expect(dropped).toHaveLength(4)
  })

  it('aliases override defaults, and null means not delivered', () => {
    const { specs, dropped } = parseClaudeHooks(
      { PostToolUse: [{ hooks: [cmd('x')] }], Stop: [{ hooks: [cmd('y')] }] },
      { aliases: { PostToolUse: 'post_tool_call', Stop: null } },
    )
    expect(specs.map((s) => s.event)).toEqual(['post_tool_call'])
    expect(dropped).toHaveLength(1)
    expect(CLAUDE_HOOK_EVENT_ALIASES.Stop).toBe('post_assistant_reply')
  })

  it('projectDirEnv sets the variable to cwd in the hook process', async () => {
    const { specs } = parseClaudeHooks({
      PreToolUse: [{ hooks: [cmd('test "$CLAUDE_PROJECT_DIR" = "$PWD"')] }],
    })
    const spec = specs[0]!
    const cwd = process.cwd()
    const approved = new Set([
      hookFingerprint({
        event: spec.event,
        command: spec.command,
        matcher: spec.matcher,
        timeoutMs: spec.timeout_ms,
      }),
    ])
    const run = async (projectDirEnv?: string) => {
      const handlers = buildHookHandlers(specs, {
        cwd,
        trusted: true,
        approved,
        ...(projectDirEnv !== undefined && { projectDirEnv }),
      })
      return handlers.pre_tool_call?.({ name: 't', args: {} } as never)
    }
    expect(await run('CLAUDE_PROJECT_DIR')).toBeUndefined()
    expect(await run()).toMatchObject({ block: true })
  })
})
