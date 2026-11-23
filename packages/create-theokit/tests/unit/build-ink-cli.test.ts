import { execFileSync } from 'node:child_process'
import {
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// @ts-expect-error plain .mjs helper without types
import * as helper from '../../tools/build-ink-cli.mjs'

describe('build-ink-cli', () => {
  const options = helper.inkCliBundleOptions({ entry: '/a/main.tsx', outfile: '/a/out.mjs' })

  it('uses the given entry and outfile with ESM output and the createRequire banner', () => {
    expect(options.entryPoints).toEqual(['/a/main.tsx'])
    expect(options.outfile).toBe('/a/out.mjs')
    expect(options.format).toBe('esm')
    expect(options.banner.js).toContain('#!/usr/bin/env node')
    expect(options.banner.js).toContain('__nodeCreateRequire(import.meta.url)')
    expect(options.external).toEqual(
      expect.arrayContaining(['node-pty', 'proper-lockfile', 'readline/promises']),
    )
    expect(options.plugins.map((p: { name: string }) => p.name)).toEqual([
      'ink-devtools-stub',
      'react-production',
    ])
  })

  it('pins NODE_ENV only inside React runtime files', () => {
    expect(helper.isReactRuntimeFile('/x/node_modules/react/index.js')).toBe(true)
    expect(helper.isReactRuntimeFile('/x/src/app.js')).toBe(false)
    expect(helper.pinReactToProduction('if (process.env.NODE_ENV)')).toBe("if ('production')")
  })

  it('builds an executable bundle that runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ink-cli-'))
    try {
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src', 'main.js'), "console.log('hi')\n")
      const outfile = await helper.buildInkCli({
        entry: join(dir, 'src', 'main.js'),
        outfile: join(dir, 'dist', 'cli.mjs'),
      })
      // One descriptor for the mode and the contents: no check-then-read race on the path.
      const fd = openSync(outfile, 'r')
      try {
        expect(fstatSync(fd).mode & 0o111).not.toBe(0)
        expect(readFileSync(fd, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true)
      } finally {
        closeSync(fd)
      }
      expect(execFileSync(process.execPath, [outfile]).toString().trim()).toBe('hi')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
