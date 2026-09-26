/**
 * A prebuilt function directory must load with no `node_modules` beside it.
 *
 * Vercel's Build Output API v3 uploads a `.func` directory as it is — nothing installs dependencies
 * for it and nothing bundles it. The adapter wrote the rendered entry straight out, so the function
 * could not start. Measured on this repository's own scaffold, 2026-09-26 (B-316), before any deploy:
 *
 *     cp -a .vercel/output/functions/api.func/. /tmp/fn/ && cd /tmp/fn
 *     node -e "import('./index.mjs')"
 *     -> ERR_MODULE_NOT_FOUND: Cannot find package 'theokit'
 *
 * `bundleDeployedFunction` is the step that closes it, and ADR 0020 is the decision — including why
 * vite rather than esbuild, and the two alternatives that cannot work.
 *
 * ## The fixture, and why it is shaped like this
 *
 * Three directories, and the separation between the last two is the whole test:
 *
 *     <tmp>/project/          the fake project. `node_modules` is a SYMLINK to this repository's,
 *                             so a bare specifier resolves — the condition a real project is in.
 *     <tmp>/project/public/   holds a file that must NOT reach the function.
 *     <tmp>/out/              the "uploaded" directory. NO node_modules in it or in any ancestor.
 *
 * If `out/` sat inside `project/`, Node's parent-directory lookup would find the symlinked
 * `node_modules` and an entry whose imports were never inlined would load anyway — the test would
 * pass over the defect it exists to catch. So the first case PROVES the isolation before anything
 * else is asserted, by writing the raw entry into `out/` and requiring that it fail.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bundleDeployedFunction } from '../../packages/theo/src/adapters/bundle-deployed-function.js'

/** A real bare specifier, so `ssr.noExternal` has something to inline. */
const ENTRY = `import { z } from 'zod'
export default function handler() {
  return z.object({ ok: z.boolean() }).parse({ ok: true })
}
`

const REPO_NODE_MODULES = resolve(import.meta.dirname, '../../node_modules')

describe('a bundled function loads without node_modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'theokit-bundle-'))
  const project = join(root, 'project')
  const out = join(root, 'out')

  beforeAll(async () => {
    mkdirSync(join(project, 'public'), { recursive: true })
    writeFileSync(join(project, 'package.json'), '{"name":"f","type":"module","private":true}\n')
    writeFileSync(join(project, 'public', 'leaked.txt'), 'this must not reach the function\n')
    symlinkSync(REPO_NODE_MODULES, join(project, 'node_modules'), 'dir')

    await bundleDeployedFunction({
      projectRoot: project,
      entrySource: ENTRY,
      stagePath: '.theokit/probe/entry.mjs',
      outDir: out,
      entryFileName: 'index.mjs',
    })
  }, 120_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('test_the_output_directory_is_genuinely_isolated', async () => {
    // COUNTERPROOF FIRST, and it is load-bearing. Every case below is satisfied by an un-bundled
    // entry if `out/` can reach a `node_modules` through a parent. This writes the RAW entry there
    // and requires it to fail, which is what makes the next case mean anything.
    const raw = join(out, 'raw-probe.mjs')
    writeFileSync(raw, ENTRY, 'utf8')

    await expect(import(/* @vite-ignore */ pathToFileURL(raw).href)).rejects.toThrow(
      /Cannot find package 'zod'/,
    )
  })

  it('test_the_bundled_entry_loads_and_its_handler_runs', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(join(out, 'index.mjs')).href)) as {
      default: () => { ok: boolean }
    }

    expect(
      typeof mod.default,
      'the bundled function does not export a handler, so the platform has nothing to invoke',
    ).toBe('function')

    // Loading is not enough: a bundle can resolve and still have lost the dependency's behaviour.
    // This runs the handler, so `zod` was inlined AND works.
    expect(mod.default()).toEqual({ ok: true })
  })

  it('test_the_entry_is_staged_inside_the_project', () => {
    // Not a style choice. Measured while establishing ADR 0020: an entry staged in `/tmp` makes
    // rollup resolve the specifier from `/tmp` and the build fails, because a specifier resolves
    // relative to the importing FILE.
    expect(existsSync(join(project, '.theokit', 'probe', 'entry.mjs'))).toBe(true)
  })

  it('test_the_public_directory_does_not_leak_into_the_function', () => {
    // With `root` at the project, vite copies the public dir by default. A lambda carrying the
    // site's static assets is waste; an `index.html` sitting beside a handler is worse, because on
    // some platforms it changes what the directory means.
    expect(existsSync(join(out, 'leaked.txt'))).toBe(false)
  })
})
