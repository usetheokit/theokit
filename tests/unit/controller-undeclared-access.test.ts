import 'reflect-metadata'

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  UndeclaredControllerAccessError,
  emitControllerArtifacts,
} from '../../packages/theo/src/cli/commands/build/emit-controllers.js'

/**
 * theokit#514 — absence must mean the same thing on both route paths.
 *
 * A file route with no `.policy` fails the build: ADR 0001 made absence stop meaning open, because
 * a route nobody thought about is the one that ships open. That guarantee did not reach controllers
 * — measured against a real app, a `@Controller` with no guard SERVED an unauthenticated request
 * while the file route it would replace returned 403, and the build said nothing either way.
 *
 * The mechanism is not missing. `@UseGuards` works: the decorator handler runs `canActivate`, and
 * a guarded method answers `403 FORBIDDEN` with no session. What is missing is the REFUSAL of
 * absence, so converting a protected route and forgetting the guard is silent.
 *
 * ## Why an escape hatch, and why it must be written down
 *
 * `'public'` exists on the file path for health checks and OAuth callbacks — routes that are open
 * on purpose. The same must be sayable here, or the gate would force a guard onto routes that
 * cannot have one and be disabled wholesale within a week. What it may not be is the DEFAULT: an
 * open route says so, in the file, where review sees it.
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_access_gate_test__')
const SERVER_DIR = join(TEST_ROOT, 'server')
const DIST_DIR = join(TEST_ROOT, '.theokit')

function write(name: string, body: string): void {
  const dir = join(SERVER_DIR, 'controllers')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${name}.controller.ts`),
    `import 'reflect-metadata'\nimport { Controller, Get, Post, UseGuards, SetMetadata } from '@theokit/http'\n\nclass AuthGuard { canActivate() { return true } }\n\n${body}\n`,
  )
}

beforeAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
  mkdirSync(DIST_DIR, { recursive: true })
})
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }))

const emit = () => emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR })

describe('a controller route that declares no access decision fails the build (#514)', () => {
  it('refuses a method with neither a guard nor an explicit opt-out', async () => {
    write(
      'bare',
      `@Controller('api/bare')\nexport class BareController {\n  @Get('items') list() { return [] }\n}`,
    )
    await expect(emit()).rejects.toThrow(UndeclaredControllerAccessError)
  })

  it('names the method and the verb, so the message points at one line', async () => {
    // A DIFFERENT filename from the case above, deliberately: two controllers are two files in a
    // real app, and reusing one name here made the emitted module collide in the ESM cache — the
    // assertion then read the previous case's class and failed for a reason that has nothing to do
    // with the gate.
    write(
      'sender',
      `@Controller('api/sender')\nexport class SenderController {\n  @Post('send') send() { return {} }\n}`,
    )
    // `await expect(...).rejects` rather than catching into a union: `emit()` resolves to a
    // manifest, so `.catch(e => e as Error)` types as `Error | ControllerBuildManifest` and every
    // `.message` read is unchecked. Caught by the workspace typecheck, which covers `tests/` —
    // `tsc -p packages/theo` does not, which is why running that one alone reported clean.
    await expect(emit()).rejects.toThrow(/SenderController/u)
    await expect(emit()).rejects.toThrow(/send/u)
    await expect(emit()).rejects.toThrow(/POST/u)
  })

  it('accepts a guard on the method', async () => {
    write(
      'm',
      `@Controller('api/m')\nexport class MController {\n  @Get() @UseGuards(AuthGuard) one() { return {} }\n}`,
    )
    await expect(emit()).resolves.toBeTruthy()
  })

  it('accepts a guard on the class, which covers every method under it', async () => {
    write(
      'c',
      `@Controller('api/c')\n@UseGuards(AuthGuard)\nexport class CController {\n  @Get('a') a() { return {} }\n  @Get('b') b() { return {} }\n}`,
    )
    await expect(emit()).resolves.toBeTruthy()
  })

  it('accepts an explicit public opt-out — a health check must stay sayable', async () => {
    write(
      'h',
      `@Controller('api/h')\nexport class HController {\n  @Get() @SetMetadata('theokit:public', true) health() { return { status: 'ok' } }\n}`,
    )
    await expect(emit()).resolves.toBeTruthy()
  })

  it('refuses when only SOME methods are covered — the uncovered one is the defect', async () => {
    // The realistic shape of the mistake: a controller converted method by method, one forgotten.
    write(
      'p',
      `@Controller('api/p')\nexport class PController {\n  @Get('a') @UseGuards(AuthGuard) a() { return {} }\n  @Post('b') b() { return {} }\n}`,
    )
    await expect(emit()).rejects.toThrow(UndeclaredControllerAccessError)
    await expect(emit()).rejects.toThrow(/\bb\b/u)
  })
})
