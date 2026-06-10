import { describe, it, expect } from 'vitest'
import { isPathAllowed, isCommandAllowed, type SandboxOptions } from '../../src/decorators/sandbox.js'

describe('Sandbox Security — Path Traversal', () => {
  const sandbox: SandboxOptions = {
    filesystem: {
      read: ['src/**'],
      write: ['src/**'],
      deny: ['.env', '*.key', 'node_modules/**'],
    },
  }

  it('test_path_traversal_blocked', () => {
    expect(isPathAllowed(sandbox, 'src/../.env', 'read')).toBe(false)
  })

  it('test_path_traversal_deep', () => {
    expect(isPathAllowed(sandbox, 'src/../../etc/passwd', 'read')).toBe(false)
  })

  it('test_path_traversal_normalized_deny', () => {
    // Even if the traversal lands in an allowed dir, deny patterns still apply
    expect(isPathAllowed(sandbox, 'src/../.env', 'write')).toBe(false)
  })

  it('test_path_null_byte_blocked', () => {
    // EC-2: null byte injection
    expect(isPathAllowed(sandbox, 'src/\x00.env', 'read')).toBe(false)
  })

  it('test_path_allowed_normal', () => {
    expect(isPathAllowed(sandbox, 'src/app.ts', 'read')).toBe(true)
  })

  it('test_path_allowed_nested', () => {
    expect(isPathAllowed(sandbox, 'src/deep/nested/file.ts', 'read')).toBe(true)
  })

  it('test_path_denied_pattern', () => {
    expect(isPathAllowed(sandbox, '.env', 'read')).toBe(false)
  })

  it('test_path_denied_glob', () => {
    expect(isPathAllowed(sandbox, 'node_modules/zod/index.js', 'read')).toBe(false)
  })

  it('test_path_no_restrictions', () => {
    expect(isPathAllowed({}, 'anything.ts', 'read')).toBe(true)
  })
})

describe('Sandbox Security — Command Injection', () => {
  const sandbox: SandboxOptions = {
    commands: {
      allow: ['npm', 'tsc', 'git diff'],
      deny: ['rm -rf', 'git push --force'],
    },
  }

  it('test_command_injection_semicolon', () => {
    expect(isCommandAllowed(sandbox, 'npm test; rm -rf /')).toBe(false)
  })

  it('test_command_injection_pipe', () => {
    expect(isCommandAllowed(sandbox, 'npm test | cat /etc/passwd')).toBe(false)
  })

  it('test_command_injection_ampersand', () => {
    expect(isCommandAllowed(sandbox, 'npm test && evil')).toBe(false)
  })

  it('test_command_injection_backtick', () => {
    expect(isCommandAllowed(sandbox, 'npm `evil`')).toBe(false)
  })

  it('test_command_injection_subshell', () => {
    expect(isCommandAllowed(sandbox, 'npm $(evil)')).toBe(false)
  })

  it('test_command_injection_redirect', () => {
    // EC-1: redirect operators
    expect(isCommandAllowed(sandbox, 'npm test > /tmp/exfil')).toBe(false)
  })

  it('test_command_injection_redirect_input', () => {
    expect(isCommandAllowed(sandbox, 'npm test < /etc/passwd')).toBe(false)
  })

  it('test_command_injection_newline', () => {
    // EC-1: newline injection
    expect(isCommandAllowed(sandbox, 'npm test\nevil_command')).toBe(false)
  })

  it('test_command_injection_carriage_return', () => {
    expect(isCommandAllowed(sandbox, 'npm test\revil')).toBe(false)
  })

  it('test_command_allowed_clean', () => {
    expect(isCommandAllowed(sandbox, 'npm test')).toBe(true)
  })

  it('test_command_allowed_exact', () => {
    expect(isCommandAllowed(sandbox, 'tsc')).toBe(true)
  })

  it('test_command_allowed_with_args', () => {
    expect(isCommandAllowed(sandbox, 'tsc --noEmit')).toBe(true)
  })

  it('test_command_denied_exact', () => {
    expect(isCommandAllowed(sandbox, 'rm -rf /')).toBe(false)
  })

  it('test_command_denied_prefix', () => {
    expect(isCommandAllowed(sandbox, 'git push --force main')).toBe(false)
  })

  it('test_command_no_restrictions', () => {
    expect(isCommandAllowed({}, 'anything')).toBe(true)
  })
})

describe('Sandbox Security — Glob Matching', () => {
  const sandbox: SandboxOptions = {
    filesystem: { read: ['src/*.ts', 'docs/**'], deny: ['*.secret'] },
  }

  it('test_glob_basic_star', () => {
    expect(isPathAllowed(sandbox, 'src/foo.ts', 'read')).toBe(true)
  })

  it('test_glob_star_no_dir_cross', () => {
    // * should NOT cross directory boundaries
    expect(isPathAllowed(sandbox, 'src/sub/foo.ts', 'read')).toBe(false)
  })

  it('test_glob_double_star', () => {
    expect(isPathAllowed(sandbox, 'docs/a/b/c.md', 'read')).toBe(true)
  })

  it('test_glob_no_redos', () => {
    // Complex pattern should complete quickly (no catastrophic backtracking)
    const complexSandbox: SandboxOptions = {
      filesystem: { read: ['a/**/b/**/c/**/d/**/e/**'] },
    }
    const start = Date.now()
    isPathAllowed(complexSandbox, 'a/x/b/y/c/z/d/w/e/file.ts', 'read')
    isPathAllowed(complexSandbox, 'a/' + 'x/'.repeat(100) + 'nope', 'read')
    expect(Date.now() - start).toBeLessThan(100) // should be <10ms
  })
})
