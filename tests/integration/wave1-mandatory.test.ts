import { describe, it, expect, beforeEach } from 'vitest'
import { scaffold } from '../../packages/create-theokit/src/index.js'
import { validateProjectStructure } from 'theokit'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Wave 1 Mandatory Tests — Scaffold', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `theo-wave1-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
  })

  it('should generate project structure with package.json, app/page.tsx, theo.config.ts', () => {
    const targetDir = join(tempDir, 'my-app')
    scaffold(targetDir, 'my-app')

    expect(existsSync(join(targetDir, 'package.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'app/page.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'theo.config.ts'))).toBe(true)
  })

  it('should produce a valid project that passes validateProjectStructure', () => {
    const targetDir = join(tempDir, 'valid-app')
    scaffold(targetDir, 'valid-app')
    expect(() => validateProjectStructure(targetDir)).not.toThrow()
  })
})

// The `Wave 1 Mandatory Tests — Dev Server` block lived here and was REMOVED with `fixtures/`. It
// booted a dev server against `fixtures/wave1-hello-theo` and asserted HTTP 200 on `/` plus
// `/@theo/entry-client` served as JavaScript. Rebuilding it in a tmpdir is not possible for the
// same reason as `tests/unit/cli-dev.test.ts`: a booting dev server needs an app whose imports
// resolve, which a project outside the repository does not have. The scaffold half above still runs.
