import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PKG_ROOT = resolve(import.meta.dirname, '../../')

describe('Pattern D1 — Legacy decorators contract', () => {
  it('test_pattern_d1_tsconfig_has_decorator_flags', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(PKG_ROOT, 'tsconfig.json'), 'utf8'))
    expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true)
    expect(tsconfig.compilerOptions.emitDecoratorMetadata).toBe(true)
  })

  it('test_pattern_d1_package_has_reflect_metadata_peer', () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8'))
    expect(pkg.peerDependencies['reflect-metadata']).toMatch(/\^0\.2\./)
  })
})
