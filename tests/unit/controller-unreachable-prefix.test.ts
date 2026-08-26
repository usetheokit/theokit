import 'reflect-metadata'

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  UnreachableControllerPathError,
  emitControllerArtifacts,
} from '../../packages/theo/src/cli/commands/build/emit-controllers.js'

/**
 * A controller whose path can never be reached must fail the BUILD, not 404 at runtime.
 *
 * Both runtimes gate the controller fall-through on the request URL:
 *
 *   start/handlers.ts:430      if (!c.url.startsWith('/api/')) return false
 *   vite-plugin/api-middleware if (!url.startsWith('/api/')) return true
 *
 * So `@Controller('probe')` declares `/probe`, which that branch never visits. The build compiled
 * it, emitted it, wrote it into the manifest, and the route answered 404 — measured against
 * `theokit@0.56.0` with a real app. `/probe` itself returned 200, which is worse than the 404:
 * that is the SPA fallback handing back `index.html`, so even the status code agrees with success.
 *
 * This is the same defect this module's own docblock already refuses for compile errors — "would
 * ship an app whose routes 404 at runtime with nothing pointing back at the cause". A path the
 * runtime cannot route to is that failure reached by a different road, and it deserves the same
 * answer: fail the build, name the controller, name the fix.
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_prefix_gate_test__')
const SERVER_DIR = join(TEST_ROOT, 'server')
const DIST_DIR = join(TEST_ROOT, '.theokit')

function writeController(name: string, prefix: string): void {
  const dir = join(SERVER_DIR, 'controllers')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${name}.controller.ts`),
    `import 'reflect-metadata'
import { Controller, Get } from '@theokit/http'

@Controller('${prefix}')
export class ${name[0]!.toUpperCase()}${name.slice(1)}Controller {
  @Get()
  ping() { return { ok: true } }
}
`,
  )
}

beforeAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
  mkdirSync(DIST_DIR, { recursive: true })
})

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('a controller path the runtime cannot reach fails the build', () => {
  it('refuses a prefix outside the served /api path, naming the controller and the fix', async () => {
    rmSync(join(SERVER_DIR, 'controllers'), { recursive: true, force: true })
    writeController('probe', 'probe')

    await expect(
      emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR }),
    ).rejects.toThrow(UnreachableControllerPathError)
  })

  it('names the declared path and the reachable form, so the message is actionable', async () => {
    rmSync(join(SERVER_DIR, 'controllers'), { recursive: true, force: true })
    writeController('probe', 'probe')

    const err = await emitControllerArtifacts({
      serverDir: SERVER_DIR,
      distDir: DIST_DIR,
    }).catch((e: unknown) => e as Error)

    // The three things an operator needs: which controller, what it declared, what to write.
    expect(err.message).toContain('ProbeController')
    expect(err.message).toContain('probe')
    expect(err.message).toContain('api/probe')
  })

  it('accepts a prefix under the served path', async () => {
    rmSync(join(SERVER_DIR, 'controllers'), { recursive: true, force: true })
    writeController('tasks', 'api/tasks')

    const manifest = await emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR })
    expect(manifest?.modules).toHaveLength(1)
  })

  it('accepts a leading slash and bare `api`, which are the same path written differently', async () => {
    // `@Controller('/api/x')` and `@Controller('api/x')` reach the same URL. A gate that refused
    // one of them would be enforcing a spelling, not reachability.
    rmSync(join(SERVER_DIR, 'controllers'), { recursive: true, force: true })
    writeController('slashed', '/api/slashed')
    await expect(
      emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR }),
    ).resolves.toBeTruthy()

    rmSync(join(SERVER_DIR, 'controllers'), { recursive: true, force: true })
    writeController('bare', 'api')
    await expect(
      emitControllerArtifacts({ serverDir: SERVER_DIR, distDir: DIST_DIR }),
    ).resolves.toBeTruthy()
  })
})
