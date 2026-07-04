import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { applyBareTransform } from '../../src/bare-transform.js'

describe('applyBareTransform', () => {
  let targetDir: string

  beforeEach(() => {
    targetDir = join(tmpdir(), `create-theokit-bare-test-${randomUUID()}`)
    mkdirSync(targetDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true })
  })

  it('should remove @theokit/ui from package.json dependencies', () => {
    // Arrange
    const pkg = {
      name: 'test-app',
      dependencies: { '@theokit/ui': '^0.11.0', zod: '^3.0.0' },
      devDependencies: {},
    }
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2))

    // Act
    applyBareTransform(targetDir)

    // Assert
    const result = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(result.dependencies['@theokit/ui']).toBeUndefined()
    expect(result.dependencies.zod).toBe('^3.0.0')
  })

  it('should remove @theokit/sdk from package.json dependencies', () => {
    const pkg = {
      name: 'test-app',
      dependencies: { '@theokit/sdk': '^0.1.0', zod: '^3.0.0' },
      devDependencies: {},
    }
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2))

    applyBareTransform(targetDir)

    const result = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(result.dependencies['@theokit/sdk']).toBeUndefined()
  })

  it('should remove lucide-react from package.json dependencies', () => {
    const pkg = {
      name: 'test-app',
      dependencies: { 'lucide-react': '^0.400.0' },
      devDependencies: {},
    }
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2))

    applyBareTransform(targetDir)

    const result = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(result.dependencies['lucide-react']).toBeUndefined()
  })

  it('should remove tailwind toolchain from devDependencies', () => {
    const pkg = {
      name: 'test-app',
      dependencies: {},
      devDependencies: {
        tailwindcss: '^3.0.0',
        'tailwindcss-animate': '^1.0.0',
        postcss: '^8.0.0',
        autoprefixer: '^10.0.0',
        typescript: '^5.0.0',
      },
    }
    writeFileSync(join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2))

    applyBareTransform(targetDir)

    const result = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(result.devDependencies.tailwindcss).toBeUndefined()
    expect(result.devDependencies['tailwindcss-animate']).toBeUndefined()
    expect(result.devDependencies.postcss).toBeUndefined()
    expect(result.devDependencies.autoprefixer).toBeUndefined()
    expect(result.devDependencies.typescript).toBe('^5.0.0')
  })

  it('should replace app/page.tsx with Hello Theo', () => {
    mkdirSync(join(targetDir, 'app'), { recursive: true })
    writeFileSync(join(targetDir, 'app/page.tsx'), '<div>Agent Surface</div>')

    applyBareTransform(targetDir)

    const content = readFileSync(join(targetDir, 'app/page.tsx'), 'utf-8')
    expect(content).toContain('Hello Theo')
  })

  it('should remove agents/chat.ts', () => {
    mkdirSync(join(targetDir, 'agents'), { recursive: true })
    writeFileSync(join(targetDir, 'agents/chat.ts'), 'export default {}')

    applyBareTransform(targetDir)

    expect(existsSync(join(targetDir, 'agents/chat.ts'))).toBe(false)
  })

  it('should remove tailwind.config.ts', () => {
    writeFileSync(join(targetDir, 'tailwind.config.ts'), 'export default {}')

    applyBareTransform(targetDir)

    expect(existsSync(join(targetDir, 'tailwind.config.ts'))).toBe(false)
  })

  it('should remove postcss.config.js', () => {
    writeFileSync(join(targetDir, 'postcss.config.js'), 'module.exports = {}')

    applyBareTransform(targetDir)

    expect(existsSync(join(targetDir, 'postcss.config.js'))).toBe(false)
  })

  it('should handle missing files gracefully', () => {
    // Arrange — no package.json, no app/page.tsx, no config files
    // Act & Assert — should not throw
    expect(() => applyBareTransform(targetDir)).not.toThrow()
  })

  it('should throw when _testForceError is set', () => {
    expect(() => applyBareTransform(targetDir, { _testForceError: 'disk full' })).toThrow(
      'Forced transform failure: disk full',
    )
  })
})
