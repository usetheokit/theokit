/**
 * M8 — type-state guarantees of the `AgentBuilder.create()` fluent builder. These are COMPILE-TIME assertions:
 * `npx tsc --noEmit -p packages/agents/tsconfig.test.json` fails if any `@ts-expect-error` line
 * stops erroring (the guard regressed) or any `expectTypeOf` mismatches.
 */
import { expectTypeOf } from 'vitest'
import { z } from 'zod'

import type { CustomTool } from '@theokit/sdk'

import { AgentBuilder, ContextualTool } from '../../src/bridge/agent-builder.js'
import type {
  AgentDefinition,
  InferAgentInput,
  InferAgentToolNames,
} from '../../src/bridge/define-agent.js'

// A plain tool (no required context) and a tool that REQUIRES { projectRoot: string }.
const plainTool: CustomTool = {
  name: 'echo',
  description: 'echoes',
  inputSchema: {},
  handler: () => 'ok',
}
const rootTool = ContextualTool.of(
  { name: 'read_file', description: 'reads a file', inputSchema: {}, handler: () => 'ok' },
  undefined as unknown as { projectRoot: string },
)

// ── 1. `.build()` requires `.model()` (missing-model is a COMPILE ERROR) ─────────────────────
{
  // @ts-expect-error — build() before model() is a compile error (guard demands an error arg).
  AgentBuilder.create().system('hi').build()

  // With a model, build() is callable and returns the branded AgentDefinition.
  const def = AgentBuilder.create().model('claude-sonnet-4-6').build()
  expectTypeOf(def).toExtend<AgentDefinition>()
}

// ── 2. `.model()` is set-once (double-model is a COMPILE ERROR) ──────────────────────────────
{
  // @ts-expect-error — second .model() takes `never`; passing a string is a compile error.
  AgentBuilder.create().model('a').model('b')
}

// ── 3. `.tool()` context-satisfaction (missing required context is a COMPILE ERROR) ──────────
{
  // A tool requiring { projectRoot } without .context() → compile error (guard demands error arg).
  // @ts-expect-error — agent context (EmptyContext) does not satisfy the tool's required context.
  AgentBuilder.create().model('m').tool(rootTool)

  // Provide the context first → the same tool is accepted.
  AgentBuilder.create().model('m').context({ projectRoot: '/repo' }).tool(rootTool).build()

  // A plain tool (no requirement) is always accepted, no context needed.
  AgentBuilder.create().model('m').tool(plainTool).build()
}

// ── 4. tool-name union accumulates through the chain ─────────────────────────────────────────
{
  const a = ContextualTool.of({
    name: 'alpha',
    description: '',
    inputSchema: {},
    handler: () => '',
  })
  const b = ContextualTool.of({ name: 'beta', description: '', inputSchema: {}, handler: () => '' })
  const built = AgentBuilder.create().model('m').tool(a).tool(b)
  expectTypeOf(built.__toolNames).toEqualTypeOf<('alpha' | 'beta') | undefined>()

  // The union survives `.build()` onto the branded AgentDefinition, and InferAgentToolNames
  // extracts it — the exact type the generated `.theokit/agents.d.ts` reads (end-to-end).
  const _def = built.build()
  expectTypeOf<InferAgentToolNames<typeof _def>>().toEqualTypeOf<'alpha' | 'beta'>()
}

// ── 5. `.input()` schema is lifted into the built AgentDefinition ─────────────────────────────
{
  const schema = z.object({ q: z.string() })
  const def = AgentBuilder.create().input(schema).model('m').build()
  expectTypeOf(def).toExtend<AgentDefinition<typeof schema>>()
  // DoD 5: InferAgentInput extracts the inferred input shape (used by typed client codegen).
  expectTypeOf<InferAgentInput<typeof def>>().toEqualTypeOf<{ q: string }>()
}
