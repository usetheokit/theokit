import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SandboxProvider } from '@theokit/sdk/sandbox'
import { describe, expect, it } from 'vitest'

import { createPathVetoPlugin, vetoPathCall } from '../../src/tools/path-veto.js'
import { bindToolScope } from '../../src/tools/tool-scope.js'

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'path-veto-')))
  mkdirSync(join(root, '.state'))
  mkdirSync(join(root, 'src'))
  const scope = bindToolScope({
    projectRoot: root,
    sandbox: {} as unknown as SandboxProvider,
    protectedPaths: ['.state'],
  })
  return { root, scope }
}

function runPlugin(
  scope: ReturnType<typeof setup>['scope'],
  context: unknown,
  options?: Parameters<typeof createPathVetoPlugin>[1],
) {
  let handler: ((c: unknown) => unknown) | undefined
  const plugin = createPathVetoPlugin(scope, options) as unknown as {
    register(ctx: never): void
  }
  plugin.register({
    on: (_event: string, h: (c: unknown) => unknown) => {
      handler = h
    },
  } as never)
  return handler?.(context)
}

describe('path veto', () => {
  it('a symlink inside the root pointing into a protected path is refused', () => {
    const { root, scope } = setup()
    symlinkSync(join(root, '.state'), join(root, 'src', 'link'))
    expect(vetoPathCall(scope, 'write_file', { path: 'src/link/secret' })).toMatch(/protected/)
    expect(vetoPathCall(scope, 'write_file', { path: 'src/ok.txt' })).toBeUndefined()
  })

  it('a symlink loop throws SymlinkLoopError and the plugin turns it into a block', () => {
    const { root, scope } = setup()
    symlinkSync(join(root, 'src', 'b'), join(root, 'src', 'a'))
    symlinkSync(join(root, 'src', 'a'), join(root, 'src', 'b'))
    const result = runPlugin(scope, { name: 'read_file', args: { path: 'src/a' } })
    expect(result).toMatchObject({ block: true })
  })

  it('an upper-case variant of a protected directory is refused with caseFold', () => {
    const { scope } = setup()
    expect(vetoPathCall(scope, 'write_file', { path: '.STATE/x' })).toMatch(/protected/)
    expect(
      runPlugin(scope, { name: 'write_file', args: { path: '.STATE/x' } }, { caseFold: false }),
    ).toBeUndefined()
  })

  it('apply_patch Move to into a protected path is refused', () => {
    const { scope } = setup()
    const patch =
      '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: .state/a.ts\n*** End Patch'
    expect(vetoPathCall(scope, 'apply_patch', { patch })).toMatch(/protected/)
  })

  it('git_diff with no path or a pathspec starting with : is refused', () => {
    const { scope } = setup()
    expect(vetoPathCall(scope, 'git_diff', {})).toBeDefined()
    expect(vetoPathCall(scope, 'git_diff', { path: ':(top)x' })).toBeDefined()
    expect(vetoPathCall(scope, 'git_diff', { path: 'src' })).toBeUndefined()
  })

  it('a paths argument that is not an array is a block, not a throw', () => {
    const { scope } = setup()
    expect(vetoPathCall(scope, 'read_files', { paths: 'src' })).toMatch(/malformed/)
    expect(runPlugin(scope, { name: 'read_files', args: { paths: 'src' } })).toMatchObject({
      block: true,
    })
    expect(runPlugin(scope, undefined)).toMatchObject({ block: true })
  })

  it('refuses an empty or NUL path and honours custom pathKeys', () => {
    const { scope } = setup()
    expect(vetoPathCall(scope, 'x', { path: '' })).toMatch(/malformed/)
    expect(vetoPathCall(scope, 'x', { path: 'a\u0000b' })).toMatch(/malformed/)
    expect(
      runPlugin(scope, { name: 'x', args: { target: '.state/a' } }, { pathKeys: ['target'] }),
    ).toMatchObject({ block: true })
  })

  it('git_diff with an ancestor pathspec or a wildcard that can reach a protected path is refused', () => {
    const { scope } = setup()
    expect(vetoPathCall(scope, 'git_diff', { path: '.' })).toMatch(/covers/)
    expect(vetoPathCall(scope, 'git_diff', { path: '.state*' })).toMatch(/wildcards/)
    expect(vetoPathCall(scope, 'git_diff', { path: '.state/secret' })).toMatch(/protected/)
  })

  it('git_diff path is checked even when pathKeys omit path', () => {
    const { scope } = setup()
    const result = runPlugin(
      scope,
      { name: 'git_diff', args: { path: '.state/secret' } },
      { pathKeys: ['target'] },
    )
    expect(result).toMatchObject({ block: true })
  })
})
