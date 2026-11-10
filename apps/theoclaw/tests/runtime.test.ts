import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { assertSupportedRuntime } from '../src/runtime.js'

it.each(['22.16.0', '22.23.4', '23.8.0', '24.0.0', '26.0.0'])('accepts supported Node %s', (version) => {
  expect(() => assertSupportedRuntime(version)).not.toThrow()
})

it.each(['20.19.0', '22.12.0', '22.15.9', '23.0.0', '23.7.9', 'invalid'])('refuses Node %s with an actionable minimum', (version) => {
  expect(() => assertSupportedRuntime(version)).toThrow('requires Node 22.16.0')
})

it('declares the same minimum in the app package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(pkg.engines.node).toBe('^22.16.0 || >=23.8.0')
})
