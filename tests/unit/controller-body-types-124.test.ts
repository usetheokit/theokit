import 'reflect-metadata'

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadControllerWithSwc } from '../../packages/http/dist/index.js'
import { generateClientDts } from '../../packages/theo/src/vite-plugin/app-typed-client.js'
import { collectControllerRouteData } from '../../packages/theo/src/vite-plugin/controller-client-emit.js'

/**
 * theokit#124 — request types for decorator controllers.
 *
 * #122 T2.1 shipped the RESPONSE type (`Awaited<ReturnType<...>>`) and route params, and left
 * `body?: unknown`. The ADR-2 checkpoint explained why: parameter decorators are erased runtime
 * metadata, so from the class type alone `Parameters<...>[N]` is positional-only and cannot tell
 * body from param from query. Runtime validation was never affected; the gap is editor autocomplete.
 *
 * ## The approach, and why it is the issue's option 2
 *
 * Option 1 (emit an inline TS type from the Zod schema) is a zod-to-ts reimplementation — brittle on
 * anything past the simple cases, and the ADR already rejected that shape. Option 3 (`@Body<T>()`)
 * asks the author to restate a type they already wrote.
 *
 * Option 2 emits `z.infer<typeof <the exported schema>>`, and the issue calls its blocker: the
 * codegen "needs to recover the schema's source identifier (not available from runtime metadata
 * today)". It is available — just not from the metadata. The codegen already LOADS the module, so
 * the schema on `WalkResult.bodySchema` is the very object the module exported. Matching it back to
 * an export by REFERENCE IDENTITY recovers the name, with no parsing and no guessing.
 *
 * ## The honest half
 *
 * A schema that is not exported has no name to emit, so it stays `unknown` — and the emitted line
 * says so, rather than leaving a reader to wonder why one method got types and its neighbour did
 * not. That is a real limit of the approach and is asserted below, not hidden.
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_body_types_124_test__')
const CONTROLLERS_DIR = join(TEST_ROOT, 'controllers')
const DTS_OUT = join(TEST_ROOT, '.theokit', 'client.d.ts')

const CONTROLLER_SRC = `
import 'reflect-metadata'
import { z } from 'zod'
import { Controller, Get, Post, Put, Body, Query, Param } from '@theokit/http'

// EXPORTED — recoverable by reference identity, so the client gets a real type.
export const zCreate = z.object({ title: z.string().min(3), tags: z.array(z.string()) })
export const zList = z.object({ page: z.string() })

// NOT exported — deliberately, to pin the documented fallback.
const zInline = z.object({ secret: z.string() })

@Controller('api/v2/things')
export class ThingsController {
  @Get()
  list(@Query(zList) query: z.infer<typeof zList>) {
    return [{ id: 1, page: query.page }]
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return { id: Number(id) }
  }

  @Post()
  create(@Body(zCreate) body: z.infer<typeof zCreate>) {
    return { id: 2, title: body.title }
  }

  @Put(':id')
  replace(@Body(zInline) body: z.infer<typeof zInline>) {
    return { id: 3, secret: body.secret }
  }
}
`

const EMPTY_MANIFEST = {
  version: 1 as const,
  generatedAt: '2026-07-13T00:00:00.000Z',
  routes: [],
  actions: [],
  websockets: [],
}

async function emit(): Promise<string> {
  const controllerRoutes = await collectControllerRouteData({
    controllersDir: CONTROLLERS_DIR,
    loadModule: loadControllerWithSwc,
  })
  return generateClientDts({
    manifest: EMPTY_MANIFEST,
    dtsOutPath: DTS_OUT,
    serverDir: TEST_ROOT,
    controllerRoutes,
  })
}

describe('theokit#124 — controller request types', () => {
  beforeAll(() => {
    mkdirSync(CONTROLLERS_DIR, { recursive: true })
    mkdirSync(join(TEST_ROOT, '.theokit'), { recursive: true })
    writeFileSync(join(CONTROLLERS_DIR, 'things.controller.ts'), CONTROLLER_SRC)
  })
  afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }))

  it('test_an_exported_Body_schema_becomes_a_real_body_type', async () => {
    const dts = await emit()
    // `import('zod').infer`, not a bare `z.infer`: the emitted file is an ambient `.d.ts` with no
    // import statements of its own, so `z` is not in scope there. The inline import form is what
    // actually resolves for a consumer.
    expect(
      dts,
      'the body is still `unknown` — an exported @Body schema carries everything needed to type it',
    ).toContain("body: import('zod').infer<typeof import('")
    expect(dts).toContain('zCreate')
  })

  it('test_an_exported_Query_schema_becomes_a_real_query_type', async () => {
    const dts = await emit()
    expect(dts).toContain('zList')
  })

  it('test_a_NON_exported_schema_falls_back_to_unknown_and_says_why', async () => {
    // The documented limit. `zInline` has no name the emitted `.d.ts` could reference, so it must
    // degrade — and it must degrade VISIBLY, or a reader hits one typed method next to an untyped
    // one with nothing explaining the difference.
    const dts = await emit()
    const putLine = dts.split('\n').find((l) => l.trimStart().startsWith('put:'))
    expect(putLine, 'no `put:` entry was emitted at all').toBeDefined()
    expect(putLine, 'a non-exported schema was typed — it has no name to reference').toContain(
      'unknown',
    )
    expect(
      dts,
      'the fallback is silent; a reader cannot tell why one method is typed and the next is not',
    ).toMatch(/export the schema/i)
  })

  it('test_a_method_with_no_body_schema_is_unchanged', async () => {
    // Back-compat floor: `findById` takes only a route param, so its signature must not grow a body.
    const dts = await emit()
    const getById = dts.split('\n').find((l) => l.includes('id: string') && l.includes('get:'))
    expect(getById).toBeDefined()
  })

  it('test_a_CONSUMER_of_the_emitted_client_typechecks_and_the_body_type_bites', async () => {
    // The assertions above match strings, which proves the codegen wrote what we meant — not that
    // TypeScript accepts it, and not that the type does any work. Both failures land in a
    // consumer's editor, far from here, as "the typed client is broken".
    //
    // The first version of this test compiled the emitted `.d.ts` directly with `skipLibCheck: true`
    // and was VACUOUS: that flag tells tsc to skip declaration files, so it passed with a
    // deliberately broken emit (a bare `z.infer`, with `z` not in scope). Proven by sabotage.
    //
    // A consumer `.ts` is the honest oracle: it is checked, it forces the declarations to resolve,
    // and a wrong body must be REJECTED — otherwise `body: <schema>` would be indistinguishable from
    // the `unknown` this issue set out to replace.
    const dts = await emit()
    writeFileSync(DTS_OUT, dts)
    const tsconfig = join(TEST_ROOT, 'tsconfig.compile-check.json')
    writeFileSync(
      tsconfig,
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          target: 'es2022',
          skipLibCheck: true,
          // The emitted d.ts `import()`s the controller source, so the decorators in it are part of
          // the program and need the same flag the real app compiles with.
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
        files: ['.theokit/client.d.ts', 'consumer.ts'],
      }),
    )
    const compile = (): string => {
      try {
        // build-time test harness; `npx` resolves this repo's own tsc and the argv is fully
        // controlled (no shell, no user input) — same exemption the release scripts take.
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
        execFileSync('npx', ['tsc', '-p', tsconfig], {
          cwd: resolve(__dirname, '../..'),
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        return ''
      } catch (err) {
        return (err as { stdout?: string }).stdout ?? ''
      }
    }

    // (a) the good consumer must compile
    writeFileSync(
      join(TEST_ROOT, 'consumer.ts'),
      `import { client } from '@theo/client'\n` +
        `export const ok = client.v2.things.post({ body: { title: 'abc', tags: ['x'] } })\n`,
    )
    expect(compile(), 'a correct call against the emitted client does not typecheck').toBe('')

    // (b) a WRONG body must be rejected — this is what separates a real type from `unknown`
    writeFileSync(
      join(TEST_ROOT, 'consumer.ts'),
      `import { client } from '@theo/client'\n` +
        `export const bad = client.v2.things.post({ body: { title: 123 } })\n`,
    )
    expect(
      compile(),
      'a body violating the @Body schema was ACCEPTED — the emitted type is not doing any work',
    ).not.toBe('')
  }, 180_000)

  it('test_the_response_type_still_comes_from_the_method_return', async () => {
    // The half #122 already shipped must survive: this issue adds the request side, it does not
    // trade the response side away.
    const dts = await emit()
    expect(dts).toContain('Awaited<ReturnType<InstanceType<typeof')
  })
})
