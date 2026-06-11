import { describe, it, expect } from 'vitest'
import { statSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Bundle size regression', () => {
  const distDir = resolve(__dirname, '../../dist')

  it('agents main bundle under 35KB', () => {
    const path = resolve(distDir, 'index.js')
    if (!existsSync(path)) {
      console.log('  SKIP: dist/index.js not found (run pnpm build first)')
      return
    }
    const size = statSync(path).size
    expect(size).toBeLessThan(35_000)
    console.log(`  agents/dist/index.js: ${(size / 1024).toFixed(1)} KB`)
  })

  it('agents decorators sub-path under 15KB', () => {
    const path = resolve(distDir, 'decorators.js')
    if (!existsSync(path)) {
      console.log('  SKIP: dist/decorators.js not found')
      return
    }
    const size = statSync(path).size
    expect(size).toBeLessThan(15_000)
    console.log(`  agents/dist/decorators.js: ${(size / 1024).toFixed(1)} KB`)
  })

  it('agents bridge sub-path under 20KB', () => {
    const path = resolve(distDir, 'bridge.js')
    if (!existsSync(path)) {
      console.log('  SKIP: dist/bridge.js not found')
      return
    }
    const size = statSync(path).size
    expect(size).toBeLessThan(20_000)
    console.log(`  agents/dist/bridge.js: ${(size / 1024).toFixed(1)} KB`)
  })
})
