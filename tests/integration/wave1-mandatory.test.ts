import { describe, it, expect, beforeEach } from 'vitest'
import { scaffold } from '../../packages/create-theokit/src/index.js'
import { loadConfig, validateProjectStructure } from 'theokit'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = resolve(import.meta.dirname, '../..')

/**
 * Make `import { config } from 'theokit'` resolve inside a freshly scaffolded project.
 *
 * A scaffold has no `node_modules`, so `loadConfig` cannot import the generated `theo.config.ts`
 * without one — and a full install per test is minutes. The symlink is the same shortcut
 * `scaffold-build-start-e2e.test.ts` uses, for the same reason.
 */
function linkFramework(projectDir: string): void {
  const nodeModules = join(projectDir, 'node_modules')
  mkdirSync(nodeModules, { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(nodeModules, 'theokit'), 'dir')
}

describe('Wave 1 Mandatory Tests — Scaffold', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `theo-wave1-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
  })

  it('should generate project structure with package.json, src/app/page.tsx, theo.config.ts', () => {
    const targetDir = join(tempDir, 'my-app')
    scaffold(targetDir, 'my-app')

    expect(existsSync(join(targetDir, 'package.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'src/app/page.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'theo.config.ts'))).toBe(true)
  })

  it('should produce a valid project that passes validateProjectStructure', async () => {
    const targetDir = join(tempDir, 'valid-app')
    scaffold(targetDir, 'valid-app')
    linkFramework(targetDir)

    // The pair, in the order `build`/`dev`/`routes` run it: the validator takes `appDir` from the
    // loaded config, so passing a literal here would only prove the scaffold agrees with this test.
    // Reading it from the generated `theo.config.ts` is what proves the CLI accepts what we ship —
    // and it is the assertion that fails if a future template moves `app/` without declaring it.
    const config = await loadConfig(targetDir)
    expect(config.appDir).toBe('src/app')
    expect(() => validateProjectStructure(targetDir, config.appDir)).not.toThrow()
  })
})

// There is no dev-server half to this contract: booting one needs an app whose imports resolve,
// which a project created in a tmpdir does not have. Same limit as `tests/unit/cli-dev.test.ts`.
