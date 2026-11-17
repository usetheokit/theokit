import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { requireToolchain } from '../src/cli/require-toolchain.js'

describe('requireToolchain', () => {
  it('names the missing package and the install command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'theokit-toolchain-'))
    try {
      expect(() => requireToolchain(['theokit-not-installed-pkg'], dir)).toThrow(
        /"theokit-not-installed-pkg".*npm install --save-dev theokit-not-installed-pkg/s,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes when the packages resolve', () => {
    expect(() => requireToolchain(['vite', 'tsx'], process.cwd())).not.toThrow()
  })
})
