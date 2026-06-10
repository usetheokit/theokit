import { describe, it, expect } from 'vitest'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Bundle size regression', () => {
  const distDir = resolve(__dirname, '../../dist')

  it('http-decorators main bundle under 30KB', () => {
    const size = statSync(resolve(distDir, 'index.js')).size
    expect(size).toBeLessThan(30_000)
    console.log(`  http-decorators/dist/index.js: ${(size / 1024).toFixed(1)} KB`)
  })

  it('http-decorators DTS under 40KB', () => {
    const size = statSync(resolve(distDir, 'index.d.ts')).size
    expect(size).toBeLessThan(40_000)
    console.log(`  http-decorators/dist/index.d.ts: ${(size / 1024).toFixed(1)} KB`)
  })
})
