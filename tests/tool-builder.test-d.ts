/**
 * M31 Phase 1 — `tool()` builder type-state guards (compile-time contract).
 *
 * Mirrors `packages/agents/tests/type/agent-builder.test-d.ts`: the guards are proven by
 * `@ts-expect-error` — this file FAILS to typecheck if a guard stops firing. Invalid chains live
 * in a NEVER-EXECUTED function (`.build()` throws at runtime on an incomplete chain — the runtime
 * fail-fast; here we assert only the compile-time guard).
 */
import { expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { tool } from '../packages/theo/src/server/define/tool-builder.js'
import type { CustomTool } from '../packages/theo/src/server/define/define-agent-tool.js'

test('a complete chain resolves to CustomTool', () => {
  const t = tool('read')
    .describe('Read a file')
    .input(z.object({ path: z.string() }))
    .execute(async ({ path }) => `read:${path}`)
    .build()
  expectTypeOf(t).toEqualTypeOf<CustomTool>()
})

test('execute() input is inferred from the Zod schema', () => {
  tool('typed')
    .input(z.object({ n: z.number(), flag: z.boolean() }))
    .execute((input) => {
      expectTypeOf(input).toEqualTypeOf<{ n: number; flag: boolean }>()
      return 'ok'
    })
    .build()
})

test('build() is a compile error until BOTH .input() and .execute() are set', () => {
  // Type-only: referenced (so it typechecks) but never called (an incomplete .build() throws).
  const assertGuards = () => {
    // @ts-expect-error — a tool needs .input() and .execute() before .build()
    tool('none').build()

    // @ts-expect-error — .execute(handler) must be set before .build()
    tool('inputOnly')
      .input(z.object({ n: z.number() }))
      .build()
  }
  // Reference (typechecks the body) without invoking it (an incomplete .build() throws at runtime).
  expectTypeOf(assertGuards).toBeFunction()
})
