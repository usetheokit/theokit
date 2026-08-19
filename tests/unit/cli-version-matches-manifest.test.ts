import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { cliVersion } from '../../packages/theo/src/cli/version.js'
import { CLI_VERSION as CREATE_CLI_VERSION } from '../../packages/create-theokit/src/version.js'

/**
 * `--version` must answer what is installed.
 *
 * Both CLIs carried the number as a literal: `theokit --version` said `0.1.0-alpha.0` at package
 * version 0.48.8, and `create-theokit --version` said `0.8.0` at 1.23.7. Nothing updated them,
 * because nothing could notice — a string in a source file has no relationship to the manifest
 * beside it. The number is the first thing anyone attaches to a bug report, so a wrong one costs
 * the reader of that report the time it takes to disbelieve it.
 *
 * Reading the manifest removes the copy. This test is what keeps it removed: it fails if either
 * CLI goes back to a literal, and it fails if the path a bundled CLI resolves the manifest through
 * stops leading to the right file.
 */

const ROOT = resolve(__dirname, '../..')

function manifestVersion(packageDir: string): string {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, packageDir, 'package.json'), 'utf8')) as {
    version: string
  }
  return pkg.version
}

describe('CLI --version reports the installed version', () => {
  it('theokit reports the version in packages/theo/package.json', () => {
    expect(cliVersion()).toBe(manifestVersion('packages/theo'))
  })

  it('create-theokit reports the version in packages/create-theokit/package.json', () => {
    expect(CREATE_CLI_VERSION).toBe(manifestVersion('packages/create-theokit'))
  })

  it('neither is a placeholder from an earlier release line', () => {
    expect(cliVersion()).not.toBe('0.1.0-alpha.0')
    expect(CREATE_CLI_VERSION).not.toBe('0.8.0')
  })
})
