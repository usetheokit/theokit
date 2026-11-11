import { describe, expect, it } from 'vitest'

import { bundleOptions } from './build-sea.mjs'

describe('build-sea', () => {
  it('bundles dist/cli.js to one CJS file with the version inlined', () => {
    const options = bundleOptions('1.2.3', 'dist/sea/x.cjs')
    expect(options.entryPoints).toEqual(['dist/cli.js'])
    expect(options.format).toBe('cjs')
    expect(options.define.__THEOCLAW_VERSION__).toBe('"1.2.3"')
    expect(options.define['import.meta.url']).toBeDefined()
  })
})
