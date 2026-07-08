/**
 * RED tests for T5.2 — theokit generate action <name> hardening.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 5 / T5.2.
 * EC absorbed: EC-4 (path traversal denial), EC-2-related (reserved JS names).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { generate } from '../../packages/theo/src/cli/commands/generate.js'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theokit-generate-action-'))
  // Mark as theokit project
  writeFileSync(join(cwd, 'theo.config.ts'), `export default {}`)
})

afterEach(() => {
  try {
    rmSync(cwd, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

describe('generate action — EC-4 path traversal', () => {
  it('should reject name containing ../', async () => {
    const result = await generate({ cwd, type: 'action', name: '../escape' })
    expect(result.status).toBe('invalid_name')
  })

  it('should reject name with parent-dir component segment', async () => {
    const result = await generate({ cwd, type: 'action', name: 'foo/../bar' })
    expect(result.status).toBe('invalid_name')
  })

  it('should reject name starting with /', async () => {
    const result = await generate({ cwd, type: 'action', name: '/absolute' })
    expect(result.status).toBe('invalid_name')
  })

  it('should reject name with null byte', async () => {
    const result = await generate({ cwd, type: 'action', name: 'foo\x00bar' })
    expect(result.status).toBe('invalid_name')
  })
})

describe('generate action — reserved JS names', () => {
  it('should reject "constructor"', async () => {
    const result = await generate({ cwd, type: 'action', name: 'constructor' })
    expect(result.status).toBe('invalid_name')
  })

  it('should reject "__proto__"', async () => {
    const result = await generate({ cwd, type: 'action', name: '__proto__' })
    expect(result.status).toBe('invalid_name')
  })

  it('should reject "prototype"', async () => {
    const result = await generate({ cwd, type: 'action', name: 'prototype' })
    expect(result.status).toBe('invalid_name')
  })

  it('should reject nested "constructor" (admin/constructor)', async () => {
    const result = await generate({ cwd, type: 'action', name: 'admin/constructor' })
    expect(result.status).toBe('invalid_name')
  })
})

describe('generate action — co-located test emit', () => {
  it('should emit <name>.test.ts alongside action file', async () => {
    const result = await generate({ cwd, type: 'action', name: 'create-user' })
    expect(result.status).toBe('created')
    const actionPath = join(cwd, 'server/actions/create-user.ts')
    const testPath = join(cwd, 'server/actions/create-user.test.ts')
    expect(readFileSync(actionPath, 'utf8')).toContain('action()')
    expect(readFileSync(testPath, 'utf8')).toContain('describe')
    expect(readFileSync(testPath, 'utf8')).toContain('createUser')
  })

  it('should NOT overwrite existing co-located test', async () => {
    mkdirSync(join(cwd, 'server/actions'), { recursive: true })
    const testPath = join(cwd, 'server/actions/existing.test.ts')
    writeFileSync(testPath, '// custom test content')
    const result = await generate({ cwd, type: 'action', name: 'existing' })
    // status is 'already_exists' since the action exists OR the test exists
    expect(result.status === 'already_exists' || result.status === 'created').toBe(true)
    expect(readFileSync(testPath, 'utf8')).toBe('// custom test content')
  })
})

describe('generate action — happy path (regression)', () => {
  it('should still create simple action file', async () => {
    const result = await generate({ cwd, type: 'action', name: 'simple' })
    expect(result.status).toBe('created')
    expect(result.filePath).toBe(join(cwd, 'server/actions/simple.ts'))
  })

  it('should still create nested action with valid name', async () => {
    const result = await generate({ cwd, type: 'action', name: 'admin/users' })
    expect(result.status).toBe('created')
    expect(result.filePath).toContain('server/actions/admin/users.ts')
  })
})
