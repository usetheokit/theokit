/**
 * Plan v1.2 T2.3 — `theokit migrate services-json-v1-to-v2` codemod tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  injectName,
  configDeclaresName,
  planServicesJsonMigration,
  servicesJsonMigrateCommand,
  slugify,
} from '../../packages/theo/src/cli/commands/migrate/services-json.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'services-migrate-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('slugify', () => {
  it('lowercases + drops invalid chars', () => {
    expect(slugify('MyApp_v1')).toBe('myapp-v1')
  })
  it('collapses repeated hyphens', () => {
    expect(slugify('a---b')).toBe('a-b')
  })
  it('strips leading/trailing hyphens', () => {
    expect(slugify('-foo-')).toBe('foo')
  })
})

describe('configDeclaresName', () => {
  it('detects defineConfig({ name: ... })', () => {
    const src = `import { defineConfig } from 'theokit'\nexport default defineConfig({\n  name: 'myapp',\n})`
    expect(configDeclaresName(src)).toBe(true)
  })
  it('returns false when name is absent', () => {
    const src = `import { defineConfig } from 'theokit'\nexport default defineConfig({\n  appDir: 'app',\n})`
    expect(configDeclaresName(src)).toBe(false)
  })
})

describe('injectName', () => {
  it('inserts name as the first property', () => {
    const before = `export default defineConfig({\n  appDir: 'app',\n})\n`
    const after = injectName(before, 'myapp')
    expect(after).toContain("name: 'myapp'")
    expect(after.indexOf("name: 'myapp'")).toBeLessThan(after.indexOf("appDir: 'app'"))
  })

  it('is idempotent — re-running does not duplicate name', () => {
    const before = `export default defineConfig({\n  name: 'myapp',\n  appDir: 'app',\n})\n`
    const after = injectName(before, 'myapp')
    expect(after).toBe(before)
    expect((after.match(/name:/g) ?? []).length).toBe(1)
  })
})

describe('planServicesJsonMigration', () => {
  it('uses explicit --name flag when supplied', () => {
    writeFileSync(join(tmp, 'theo.config.ts'), 'export default defineConfig({})\n', 'utf-8')
    const plan = planServicesJsonMigration({ cwd: tmp, name: 'override-app' })
    expect(plan.projectName).toBe('override-app')
    expect(plan.source).toBe('flag')
  })

  it('falls back to package.json name (slugified)', () => {
    writeFileSync(join(tmp, 'theo.config.ts'), 'export default defineConfig({})\n', 'utf-8')
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: '@org/My_App' }))
    const plan = planServicesJsonMigration({ cwd: tmp })
    expect(plan.projectName).toBe('orgmy-app')
    expect(plan.source).toBe('package-json')
  })

  it('falls back to services-bundle with a warning when nothing resolves', () => {
    writeFileSync(join(tmp, 'theo.config.ts'), 'export default defineConfig({})\n', 'utf-8')
    // empty package.json, directory basename is the tmp prefix which contains hyphens
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({}))
    const plan = planServicesJsonMigration({
      cwd: '/',
      configPath: join(tmp, 'theo.config.ts'),
      pkgPath: join(tmp, 'package.json'),
      name: '',
    })
    // Directory basename of "/" is empty → fallback applies.
    expect(plan.projectName).toBe('services-bundle')
    expect(plan.source).toBe('fallback')
    expect(plan.warning.length).toBeGreaterThan(0)
  })

  it('detects already-migrated configs (idempotent)', () => {
    writeFileSync(
      join(tmp, 'theo.config.ts'),
      "export default defineConfig({ name: 'foo' })\n",
      'utf-8',
    )
    const plan = planServicesJsonMigration({ cwd: tmp })
    expect(plan.alreadyMigrated).toBe(true)
  })
})

describe('servicesJsonMigrateCommand', () => {
  it('end-to-end — writes name into theo.config.ts', async () => {
    const configPath = join(tmp, 'theo.config.ts')
    writeFileSync(
      configPath,
      "import { defineConfig } from 'theokit'\nexport default defineConfig({\n  appDir: 'app',\n})\n",
      'utf-8',
    )
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'dogfood' }))
    await servicesJsonMigrateCommand({ cwd: tmp, silent: true })
    const updated = readFileSync(configPath, 'utf-8')
    expect(updated).toContain("name: 'dogfood'")
  })

  it('dry-run does not modify the file', async () => {
    const configPath = join(tmp, 'theo.config.ts')
    const original = "export default defineConfig({\n  appDir: 'app',\n})\n"
    writeFileSync(configPath, original, 'utf-8')
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'dogfood' }))
    await servicesJsonMigrateCommand({ cwd: tmp, silent: true, dryRun: true })
    expect(readFileSync(configPath, 'utf-8')).toBe(original)
  })

  it('throws when theo.config.ts is missing', async () => {
    expect(existsSync(join(tmp, 'theo.config.ts'))).toBe(false)
    await expect(servicesJsonMigrateCommand({ cwd: tmp, silent: true })).rejects.toThrow(
      /theo\.config\.ts/u,
    )
  })
})
