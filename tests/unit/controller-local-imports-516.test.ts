import 'reflect-metadata'

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { emitControllerArtifacts } from '../../packages/theo/src/cli/commands/build/emit-controllers.js'

/**
 * theokit#516 — a controller that imports the app's own code must survive the build.
 *
 * Measured before this fix: `theokit dev` served such a controller and `theokit build` refused it —
 * the #123 dev/prod split, reappearing through a different door.
 *
 * The cause is where the compiled module LANDS. Controllers are compiled into `<distDir>/controllers`
 * because parameter decorators need metadata only swc emits; file routes are never compiled at all,
 * and in production are loaded straight from the source tree by `importUserModule`. So a relative
 * specifier written against the source resolves, in the emitted module, from `dist` — where the app
 * does not exist. `../auth/index.js` becomes `.theokit/auth/index.js`, which nothing writes.
 *
 * Bare specifiers were never affected, which is exactly why no test caught it: the #123 fixture
 * imports `zod` and `@theokit/http` and nothing else, so it never exercised a relative one.
 *
 * The fix rewrites relative specifiers to absolute paths into the SOURCE tree — the same files the
 * app runs from, loaded the same way file routes already are. Nothing is copied, nothing is
 * bundled, and one definition of the app's modules stays.
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_local_imports_test__')
const SERVER_DIR = join(TEST_ROOT, 'server')
const DIST_DIR = join(TEST_ROOT, '.theokit')

beforeAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
  mkdirSync(join(SERVER_DIR, 'services'), { recursive: true })
  mkdirSync(join(SERVER_DIR, 'controllers'), { recursive: true })
  mkdirSync(DIST_DIR, { recursive: true })

  writeFileSync(
    join(SERVER_DIR, 'services', 'greeter.ts'),
    `export const greeter = { hello: () => 'from app code' }\n`,
  )
  writeFileSync(
    join(SERVER_DIR, 'controllers', 'greet.controller.ts'),
    `import 'reflect-metadata'
import { Controller, Get, SetMetadata } from '@theokit/http'
import { z } from 'zod'

import { greeter } from '../services/greeter.js'

export const zGreeting = z.object({ text: z.string() })

@Controller('api/greet')
@SetMetadata('theokit:public', true)
export class GreetController {
  @Get()
  greet() { return { text: greeter.hello() } }
}
`,
  )
})

afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }))

describe('a controller may import the app it belongs to (#516)', () => {
  it('builds without refusing the relative specifier', async () => {
    await expect(
      emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR }),
    ).resolves.toBeTruthy()
  })

  it('the emitted module resolves the app import, and the handler returns its value', async () => {
    // The assertion that matters. Emitting a file proves the build ran; loading it and calling the
    // handler proves the import it carries points at something real.
    await emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR })
    const mod: Record<string, unknown> = await import(
      join(DIST_DIR, 'controllers', 'greet.controller.mjs')
    )
    const Cls = mod.GreetController as new () => { greet: () => { text: string } }
    expect(new Cls().greet()).toEqual({ text: 'from app code' })
  })

  it('leaves bare specifiers alone — they resolve from anywhere and must not be rewritten', async () => {
    await emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR })
    // Asserted on the SPECIFIERS, not on a `from "…"` spelling: swc emits its own import forms and
    // an assertion on the surrounding syntax tests the compiler rather than the rewrite. What must
    // hold is that a package name survives verbatim and never becomes a path.
    const code = readFileSync(join(DIST_DIR, 'controllers', 'greet.controller.mjs'), 'utf-8')
    expect(code).toContain('@theokit/http')
    expect(code).toContain('zod')
    expect(code).not.toMatch(/file:\/\/[^'"]*@theokit\/http/u)
    expect(code).not.toMatch(/file:\/\/[^'"]*node_modules/u)
  })
})
