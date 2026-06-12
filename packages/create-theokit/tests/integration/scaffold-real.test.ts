import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { scaffold } from '../../src/index.js'

describe('scaffold (integration — real template)', () => {
  const tempDirs: string[] = []

  function createTargetDir(): string {
    const dir = join(tmpdir(), `create-theokit-integration-${randomUUID()}`)
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('should produce a valid TheoKit project from the default template', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'integration-test-app')

    // package.json exists with correct name
    const pkgPath = join(targetDir, 'package.json')
    expect(existsSync(pkgPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    expect(pkg.name).toBe('integration-test-app')
    expect(pkg.version).toBe('0.1.0')
    expect(pkg.type).toBe('module')

    // Core template structure
    expect(existsSync(join(targetDir, 'app/page.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'app/layout.tsx'))).toBe(true)
    expect(existsSync(join(targetDir, 'server'))).toBe(true)
    expect(existsSync(join(targetDir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'theo.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'index.html'))).toBe(true)
    expect(existsSync(join(targetDir, 'app.tsx'))).toBe(false)

    // .gitignore renamed from _gitignore
    expect(existsSync(join(targetDir, '.gitignore'))).toBe(true)
    expect(existsSync(join(targetDir, '_gitignore'))).toBe(false)

    // No leftover .tmpl files
    expect(existsSync(join(targetDir, 'package.json.tmpl'))).toBe(false)
    expect(existsSync(join(targetDir, 'README.md.tmpl'))).toBe(false)
  })

  it('should produce a valid README.md with project name substituted', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'readme-test')

    const readme = readFileSync(join(targetDir, 'README.md'), 'utf-8')
    expect(readme).toContain('readme-test')
    expect(readme).not.toContain('{{name}}')
  })

  it('should produce a working package.json with expected scripts', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'scripts-test')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts).toBeDefined()
    expect(pkg.scripts.dev).toBeDefined()
    expect(pkg.scripts.build).toBeDefined()
    expect(pkg.scripts.start).toBeDefined()
  })

  it('should produce a working package.json with expected dependencies', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'deps-test')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies).toBeDefined()
    expect(pkg.devDependencies).toBeDefined()
    expect(pkg.dependencies.zod).toBeDefined()
  })

  it('should include AGENTS.md in the scaffold', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'agents-test')

    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(true)
  })

  it('should include .env.example', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'env-test')

    expect(existsSync(join(targetDir, '.env.example'))).toBe(true)
  })

  it('should produce a bare scaffold with Hello Theo page', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'bare-test', 'default', { bare: true })

    // page.tsx should have Hello Theo
    const page = readFileSync(join(targetDir, 'app/page.tsx'), 'utf-8')
    expect(page).toContain('Hello Theo')

    // SDK-dependent deps should be removed
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies?.['@theokit/ui']).toBeUndefined()
    expect(pkg.dependencies?.['@theokit/sdk']).toBeUndefined()
  })

  it('should use theokit as main dep instead of standalone @theokit/http', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'framework-test')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    // theokit is the main dep
    expect(pkg.dependencies.theokit).toMatch(/^\^0\.\d+\.\d+/)
    // @theokit/http and @theokit/agents are NOT direct deps (transitive via theokit)
    expect(pkg.dependencies['@theokit/http']).toBeUndefined()
    expect(pkg.dependencies['@theokit/agents']).toBeUndefined()
    // reflect-metadata is NOT a direct dep (theokit handles it internally)
    expect(pkg.dependencies['reflect-metadata']).toBeUndefined()
    // @swc/core IS a devDep (required for parameter decorators @Body/@Param/@Query)
    expect(pkg.devDependencies['@swc/core']).toBeDefined()
    // Scripts use theokit CLI
    expect(pkg.scripts.dev).toBe('theokit dev')
    expect(pkg.scripts.build).toBe('theokit build')
    expect(pkg.scripts.start).toBe('theokit start')
  })

  it('should include theo.config.ts and index.html, not app.tsx or client.js', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'structure-test')

    expect(existsSync(join(targetDir, 'theo.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'index.html'))).toBe(true)
    expect(existsSync(join(targetDir, 'app.tsx'))).toBe(false)
    expect(existsSync(join(targetDir, 'public/client.js'))).toBe(false)
    expect(existsSync(join(targetDir, 'server/routes/health.ts'))).toBe(true)
  })

  it('should import globals.css from app/ not public/', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'css-test')

    expect(existsSync(join(targetDir, 'app/globals.css'))).toBe(true)
    expect(existsSync(join(targetDir, 'public/globals.css'))).toBe(false)
    const layout = readFileSync(join(targetDir, 'app/layout.tsx'), 'utf-8')
    expect(layout).toContain("import './globals.css'")
    expect(layout).not.toContain('<link rel="stylesheet"')
  })

  it('should have React hooks in page.tsx instead of vanilla JS', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'hooks-test')

    const page = readFileSync(join(targetDir, 'app/page.tsx'), 'utf-8')
    expect(page).toContain('useState')
    expect(page).toContain('useEffect')
    expect(page).toContain('onClick')
    expect(page).not.toContain('<script src')
  })

  it('should preserve non-tmpl files from the template', () => {
    const targetDir = createTargetDir()

    scaffold(targetDir, 'preserve-test')

    // .prettierrc, eslint.config.mjs, tsconfig.json are not .tmpl files
    expect(existsSync(join(targetDir, '.prettierrc'))).toBe(true)
    expect(existsSync(join(targetDir, 'eslint.config.mjs'))).toBe(true)
    expect(existsSync(join(targetDir, 'tsconfig.json'))).toBe(true)
  })
})
