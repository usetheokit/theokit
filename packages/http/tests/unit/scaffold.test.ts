import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PKG_ROOT = resolve(import.meta.dirname, '../../')

describe('T1.1 — Package scaffold', () => {
  it('test_scaffold_package_json_has_correct_fields', () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@theokit/http')
    expect(pkg.version).toBe('0.4.0')
    expect(pkg.type).toBe('module')
    expect(pkg.peerDependencies).toHaveProperty('reflect-metadata')
    expect(pkg.peerDependencies).toHaveProperty('theokit')
    expect(pkg.peerDependencies).toHaveProperty('zod')
  })

  it('test_scaffold_tsconfig_has_decorator_flags', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(PKG_ROOT, 'tsconfig.json'), 'utf8'))
    expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true)
    expect(tsconfig.compilerOptions.emitDecoratorMetadata).toBe(true)
    expect(tsconfig.compilerOptions.strict).toBe(true)
  })
})
