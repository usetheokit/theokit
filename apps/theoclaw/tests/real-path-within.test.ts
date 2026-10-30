import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isWithin } from '../src/tools/real-path.js'

/**
 * `isWithin` decides whether a tool's path stays inside a workspace root, so each case below is a
 * path a veto must answer correctly: a wrong `true` lets a tool out of its root, a wrong `false`
 * refuses a file the person put there.
 */

const ROOT = resolve('/srv', 'workspace')

describe('isWithin', () => {
  it('holds for the directory itself', () => {
    expect(isWithin(ROOT, ROOT)).toBe(true)
  })

  it('holds for a child of the directory', () => {
    expect(isWithin(join(ROOT, 'notes', 'today.md'), ROOT)).toBe(true)
  })

  it('holds for a child whose name starts with two dots', () => {
    expect(isWithin(join(ROOT, '..foo'), ROOT)).toBe(true)
  })

  it('refuses a sibling whose name extends the directory name', () => {
    expect(isWithin(resolve('/srv', 'workspace-other', 'secret'), ROOT)).toBe(false)
  })

  it('refuses the parent directory', () => {
    expect(isWithin(resolve('/srv'), ROOT)).toBe(false)
  })

  it('refuses a path that climbs out through the parent', () => {
    expect(isWithin(join(ROOT, '..', 'etc', 'passwd'), ROOT)).toBe(false)
  })

  it('refuses a path whose offset from the directory is absolute', () => {
    expect(isWithin(resolve('/etc', 'passwd'), ROOT)).toBe(false)
  })

  it('compares case-sensitively by default', () => {
    expect(isWithin(resolve('/SRV', 'Workspace', 'notes'), ROOT)).toBe(false)
  })

  it('compares case-insensitively when caseFold is true', () => {
    expect(isWithin(resolve('/SRV', 'Workspace', 'notes'), ROOT, { caseFold: true })).toBe(true)
  })

  it('still refuses an escape when caseFold is true', () => {
    expect(isWithin(resolve('/SRV', 'Workspace-Other'), ROOT, { caseFold: true })).toBe(false)
  })
})
