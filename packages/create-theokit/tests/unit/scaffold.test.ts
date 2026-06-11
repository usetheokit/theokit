import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { scaffold } from '../../src/index.js'

describe('scaffold', () => {
  let targetDir: string

  beforeEach(() => {
    targetDir = join(tmpdir(), `create-theokit-scaffold-test-${randomUUID()}`)
  })

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true })
  })

  it('should create the target directory with template files', () => {
    scaffold(targetDir, 'test-app')

    expect(existsSync(targetDir)).toBe(true)
    expect(existsSync(join(targetDir, 'app'))).toBe(true)
    expect(existsSync(join(targetDir, 'server'))).toBe(true)
  })

  it('should rename _gitignore to .gitignore', () => {
    scaffold(targetDir, 'test-app')

    expect(existsSync(join(targetDir, '.gitignore'))).toBe(true)
    expect(existsSync(join(targetDir, '_gitignore'))).toBe(false)
  })

  it('should replace {{name}} placeholder in .tmpl files', () => {
    scaffold(targetDir, 'my-cool-app')

    // package.json.tmpl becomes package.json with name substituted
    const pkgPath = join(targetDir, 'package.json')
    expect(existsSync(pkgPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    expect(pkg.name).toBe('my-cool-app')
  })

  it('should remove .tmpl suffix from template files', () => {
    scaffold(targetDir, 'test-app')

    expect(existsSync(join(targetDir, 'package.json.tmpl'))).toBe(false)
    expect(existsSync(join(targetDir, 'package.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'README.md.tmpl'))).toBe(false)
    expect(existsSync(join(targetDir, 'README.md'))).toBe(true)
  })

  it('should replace {{name}} in README.md.tmpl', () => {
    scaffold(targetDir, 'my-project')

    const readme = readFileSync(join(targetDir, 'README.md'), 'utf-8')
    expect(readme).toContain('my-project')
    expect(readme).not.toContain('{{name}}')
  })

  it('should throw for invalid project names', () => {
    expect(() => scaffold(targetDir, 'My App')).toThrow(/Invalid project name/)
    expect(() => scaffold(targetDir, '-bad-name')).toThrow(/Invalid project name/)
    expect(() => scaffold(targetDir, 'UPPERCASE')).toThrow(/Invalid project name/)
  })

  it('should accept valid project names', () => {
    expect(() => scaffold(targetDir, 'my-app')).not.toThrow()

    // Clean up and test more valid names
    rmSync(targetDir, { recursive: true, force: true })
    targetDir = join(tmpdir(), `create-theokit-scaffold-test-${randomUUID()}`)
    expect(() => scaffold(targetDir, 'app123')).not.toThrow()

    rmSync(targetDir, { recursive: true, force: true })
    targetDir = join(tmpdir(), `create-theokit-scaffold-test-${randomUUID()}`)
    expect(() => scaffold(targetDir, 'my.app')).not.toThrow()
  })

  it('should throw for unknown template name', () => {
    expect(() => scaffold(targetDir, 'test-app', 'nonexistent-template')).toThrow(
      /Template "nonexistent-template" not found/,
    )
  })

  it('should throw when target directory is not empty', () => {
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'existing-file.txt'), 'hello')

    expect(() => scaffold(targetDir, 'test-app')).toThrow(/not empty/)
  })

  it('should succeed when target directory exists but is empty', () => {
    mkdirSync(targetDir, { recursive: true })

    expect(() => scaffold(targetDir, 'test-app')).not.toThrow()
    expect(existsSync(join(targetDir, 'package.json'))).toBe(true)
  })

  it('should use directory basename when projectName is "."', () => {
    // "." means current directory — the scaffold resolves basename from targetDir
    const dotDir = join(tmpdir(), `create-theokit-dot-test-${randomUUID()}`, 'validname')
    mkdirSync(dotDir, { recursive: true })

    scaffold(dotDir, '.')

    const pkg = JSON.parse(readFileSync(join(dotDir, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('validname')

    rmSync(dotDir, { recursive: true, force: true })
  })

  it('should throw when --bare is used with non-default template', () => {
    expect(() => scaffold(targetDir, 'test-app', 'dashboard', { bare: true })).toThrow(
      /--bare flag only applies to the default template/,
    )
  })

  it('should apply bare transform when bare option is true', () => {
    scaffold(targetDir, 'test-app', 'default', { bare: true })

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    // @theokit/ui should be removed by bare transform
    expect(pkg.dependencies?.['@theokit/ui']).toBeUndefined()
    // Page should be Hello Theo
    const page = readFileSync(join(targetDir, 'app/page.tsx'), 'utf-8')
    expect(page).toContain('Hello Theo')
  })

  it('should rollback on bare transform failure (EC-4)', () => {
    expect(() =>
      scaffold(targetDir, 'test-app', 'default', {
        bare: true,
        _testForceTransformError: 'simulated disk error',
      }),
    ).toThrow(/Scaffold rolled back/)

    // Target directory should be cleaned up
    expect(existsSync(targetDir)).toBe(false)
  })
})
