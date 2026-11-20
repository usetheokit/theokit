import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isWithin, resolveRealPath, SymlinkLoopError } from '../../src/tools/real-path.js'

const temp = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'real-path-')))

describe('resolveRealPath', () => {
  it('a dangling symlink is followed to its target', () => {
    const dir = temp()
    symlinkSync(join(dir, 'target.txt'), join(dir, 'link'))
    expect(resolveRealPath(join(dir, 'link'))).toBe(join(dir, 'target.txt'))
  })

  it('places a missing child under its symlinked parent', () => {
    const dir = temp()
    mkdirSync(join(dir, 'real'))
    symlinkSync(join(dir, 'real'), join(dir, 'via'))
    writeFileSync(join(dir, 'real', 'a'), '')
    expect(resolveRealPath(join(dir, 'via', 'new', 'x'))).toBe(join(dir, 'real', 'new', 'x'))
  })

  it('a symlink loop throws SymlinkLoopError', () => {
    const dir = temp()
    symlinkSync(join(dir, 'b'), join(dir, 'a'))
    symlinkSync(join(dir, 'a'), join(dir, 'b'))
    expect(() => resolveRealPath(join(dir, 'a'))).toThrow(SymlinkLoopError)
  })

  it('maxHops bounds a dangling chain', () => {
    const dir = temp()
    symlinkSync(join(dir, 'b'), join(dir, 'a'))
    symlinkSync(join(dir, 'c'), join(dir, 'b'))
    expect(() => resolveRealPath(join(dir, 'a'), { maxHops: 1 })).toThrow(SymlinkLoopError)
    expect(resolveRealPath(join(dir, 'a'))).toBe(join(dir, 'c'))
  })
})

describe('resolveRealPath hops and ancestors', () => {
  it('a child beneath a self-loop throws SymlinkLoopError', () => {
    const dir = temp()
    symlinkSync(join(dir, 'loop'), join(dir, 'loop'))
    expect(() => resolveRealPath(join(dir, 'loop', 'child'))).toThrow(SymlinkLoopError)
  })

  it('maxHops counts links to existing targets', () => {
    const dir = temp()
    writeFileSync(join(dir, 'file'), '')
    symlinkSync(join(dir, 'file'), join(dir, 'link'))
    expect(() => resolveRealPath(join(dir, 'link'), { maxHops: 0 })).toThrow(SymlinkLoopError)
    expect(resolveRealPath(join(dir, 'link'), { maxHops: 1 })).toBe(join(dir, 'file'))
  })
})

describe('isWithin', () => {
  it('compares containment, optionally case-folded', () => {
    expect(isWithin('/a/b/c', '/a/b')).toBe(true)
    expect(isWithin('/a/b', '/a/b')).toBe(true)
    expect(isWithin('/a/bc', '/a/b')).toBe(false)
    expect(isWithin('/a/B/c', '/a/b')).toBe(false)
    expect(isWithin('/a/B/c', '/a/b', { caseFold: true })).toBe(true)
  })
})
