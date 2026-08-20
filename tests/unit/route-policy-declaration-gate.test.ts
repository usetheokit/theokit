import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { callProcedure } from '../../packages/theo/src/server/http/in-process-caller.js'
import type { RouteConfig } from '../../packages/theo/src/core/contracts/route-config.js'
import { MissingRoutePolicyError } from '../../packages/theo/src/server/scan/errors.js'
import { scanServerRoutes } from '../../packages/theo/src/server/scan/scan.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'

/**
 * ADR 0001, Decision point 5 - "a route declares its policy explicitly,
 * including `public`. Absence stops meaning open." - verified by the ADR's own
 * criterion: "a route with no declared policy fails the build, naming the file".
 *
 * The gate is on ROUTES SCANNED FROM THE FILE SYSTEM, which is what an
 * application declares and what `theo build` / `theo start` load. It is not a
 * runtime check over any `RouteConfig`: a config built inline and handed
 * straight to an executor never passed a scanner, and making the executors
 * refuse it would turn a build gate into a runtime break for callers the ADR
 * never addressed. The last test in this file is what holds that line.
 */

let serverDir: string

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'theo-policy-gate-'))
  serverDir = join(base, 'server')
  mkdirSync(join(serverDir, 'routes'), { recursive: true })
})

function touch(relativePath: string, content: string): string {
  const full = join(serverDir, 'routes', relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  return full
}

describe('scanServerRoutes refuses a route that declares no policy', () => {
  it('throws MissingRoutePolicyError naming the offending file', () => {
    const file = touch('users.ts', `export const GET = { handler: () => ({}) }\n`)

    expect(() => scanServerRoutes(serverDir)).toThrow(MissingRoutePolicyError)
    try {
      scanServerRoutes(serverDir)
      expect.unreachable('scan should have refused the undeclared route')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingRoutePolicyError)
      const err = error as MissingRoutePolicyError
      expect(err.file).toBe(file)
      expect(err.methods).toEqual(['GET'])
      expect(err.routePath).toBe('/api/users')
      expect(err.message).toContain(file)
    }
  })

  it('names the method and the exact way out, including that `public` is a decision', () => {
    touch(
      'posts/[id].ts',
      `export const GET = { handler: () => ({}) }\nexport const DELETE = { handler: () => ({}) }\n`,
    )

    try {
      scanServerRoutes(serverDir)
      expect.unreachable('scan should have refused the undeclared route')
    } catch (error) {
      const message = (error as Error).message
      // Which methods, so the reader does not have to diff the file by hand.
      expect(message).toContain('DELETE, GET')
      // The way out, spelled as code rather than described.
      expect(message).toContain(`.policy('public')`)
      // And the warning that taking it is a decision, not a default.
      expect(message).toContain('decision')
    }
  })

  it('lists only the methods that are missing one', () => {
    touch(
      'mixed.ts',
      [
        `import { route } from 'theokit/server'`,
        `export const GET = route().policy('public').handler(() => ({})).build()`,
        `export const POST = route().handler(() => ({})).build()`,
        ``,
      ].join('\n'),
    )

    try {
      scanServerRoutes(serverDir)
      expect.unreachable('scan should have refused the undeclared method')
    } catch (error) {
      expect((error as MissingRoutePolicyError).methods).toEqual(['POST'])
    }
  })

  it('refuses a bare function export, which has nowhere to declare a policy', () => {
    touch('legacy.ts', `export function GET() {\n  return {}\n}\n`)

    expect(() => scanServerRoutes(serverDir)).toThrow(MissingRoutePolicyError)
  })

  it('is not satisfied by the word `policy` appearing inside the handler body', () => {
    touch('sneaky.ts', `export const GET = { handler: () => ({ policy: 'public' }) }\n`)

    expect(() => scanServerRoutes(serverDir)).toThrow(MissingRoutePolicyError)
  })
})

describe('scanServerRoutes accepts a route that declares one', () => {
  it('accepts the builder form', () => {
    touch(
      'health.ts',
      [
        `import { route } from 'theokit/server'`,
        `export const GET = route()`,
        `  .policy('public')`,
        `  .handler(() => ({ ok: true }))`,
        `  .build()`,
        ``,
      ].join('\n'),
    )

    expect(scanServerRoutes(serverDir).map((r) => r.routePath)).toEqual(['/api/health'])
  })

  it('accepts the object form', () => {
    touch(
      'thing.ts',
      [
        `import { defineRoute } from 'theokit/server'`,
        `export const GET = defineRoute({`,
        `  policy: ({ subject }) => subject !== null,`,
        `  handler: () => ({}),`,
        `})`,
        ``,
      ].join('\n'),
    )

    expect(scanServerRoutes(serverDir)).toHaveLength(1)
  })

  it('leaves a file with no HTTP exports alone', () => {
    touch('_helpers.ts', `export const shared = 1\n`)

    expect(scanServerRoutes(serverDir)).toHaveLength(1)
  })
})

/**
 * The scope line. A `RouteConfig` built in memory and handed to an executor is
 * not a scanned route - nothing walked a directory to find it - and the gate
 * must not reach it. If this test ever goes red, the build gate has leaked into
 * the runtime and every direct caller of `executeWebRequest` / `callProcedure`
 * broke with it.
 */
describe('an inline RouteConfig is untouched by the gate', () => {
  const inlineRoute = {
    handler: () => ({ ok: true }),
  } as unknown as RouteConfig

  it('still executes over the Web executor with no policy declared', async () => {
    const response = await executeWebRequest(new Request('http://localhost/api/inline'), {
      GET: inlineRoute,
    } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('still executes in-process with no policy declared', async () => {
    await expect(callProcedure(inlineRoute as never)).resolves.toEqual({ ok: true })
  })
})
