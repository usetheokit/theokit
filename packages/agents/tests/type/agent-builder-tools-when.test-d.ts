/**
 * M69 — `.tools([...])` and `.when(cond, fn)` on the `AgentBuilder`, at the type level.
 *
 * ## Why the builder needed these
 *
 * The chain exposed only `.tool(tool, ...guard)` — one tool, one call. For any real product the tool
 * SET is computed at runtime (which tools an agent gets depends on sandbox mode, surface profile and
 * trust), and a computed set could not be expressed in the chain at all. The measured consumer had
 * to fold outside it:
 *
 *     allTools.reduce((acc, tool) => acc.tool(tool), chain)
 *
 * That fold works and loses the type-state: the accumulated tool-name union collapses, so
 * `InferAgentToolNames` stops seeing the literal names the generated client is built from. The
 * escape hatch existed and cost exactly the guarantee the builder is for.
 *
 * `.use(preset)` composes a whole sub-chain but cannot skip a link in the middle, which is the other
 * half of the same gap — a conditional element.
 *
 * These are COMPILE-TIME assertions: `npx tsc --noEmit -p packages/agents/tsconfig.test.json` fails
 * if any `expectTypeOf` mismatches.
 */
import { expectTypeOf } from 'vitest'

import { AgentBuilder, ContextualTool } from '../../src/bridge/agent-builder.js'
import type { InferAgentToolNames } from '../../src/bridge/define-agent.js'

const a = ContextualTool.of({
  name: 'alpha' as const,
  description: 'a',
  inputSchema: {},
  handler: () => 'ok',
})
const b = ContextualTool.of({
  name: 'beta' as const,
  description: 'b',
  inputSchema: {},
  handler: () => 'ok',
})
const c = ContextualTool.of({
  name: 'gamma' as const,
  description: 'c',
  inputSchema: {},
  handler: () => 'ok',
})

// ── 1. `.tools([a, b]).tool(c)` accumulates the SAME union as three singular calls ────────────
{
  const _viaList = AgentBuilder.create().model('m').tools([a, b]).tool(c).build()
  const _viaSingles = AgentBuilder.create().model('m').tool(a).tool(b).tool(c).build()

  expectTypeOf<InferAgentToolNames<typeof _viaList>>().toEqualTypeOf<'alpha' | 'beta' | 'gamma'>()
  expectTypeOf<InferAgentToolNames<typeof _viaList>>().toEqualTypeOf<
    InferAgentToolNames<typeof _viaSingles>
  >()
}

// ── 2. An EMPTY list is a typed no-op, not a widening to `string` ─────────────────────────────
{
  // The trap this guards: a naive `TList[number]` on `[]` infers `never`, and a naive fallback
  // widens the union to `string` — either way the accumulated names are lost for the whole chain,
  // and the failure only shows up in the generated client.
  const _def = AgentBuilder.create().model('m').tool(a).tools([]).build()
  expectTypeOf<InferAgentToolNames<typeof _def>>().toEqualTypeOf<'alpha'>()
}

// ── 3. `.when(false, …)` is a typed no-op; `.when(true, …)` keeps the branch's names ──────────
{
  // The condition is a plain boolean, already computed — never a predicate with access to context.
  // A predicate would invite business logic into the authoring chain (the milestone's named risk).
  const _off = AgentBuilder.create()
    .model('m')
    .tool(a)
    .when(false, (chain) => chain.tool(b))
    .build()
  const _on = AgentBuilder.create()
    .model('m')
    .tool(a)
    .when(true, (chain) => chain.tool(b))
    .build()

  // Both branches must produce the SAME type: the condition is a runtime value, so the type cannot
  // depend on it. The union is the one the branch COULD add — which is what makes `.when` usable in
  // the middle of a chain without collapsing the type-state.
  expectTypeOf<InferAgentToolNames<typeof _off>>().toEqualTypeOf<'alpha' | 'beta'>()
  expectTypeOf<InferAgentToolNames<typeof _on>>().toEqualTypeOf<'alpha' | 'beta'>()
}

// ── 4. `.when` preserves the rest of the type-state (model stays set) ─────────────────────────
{
  // If `.when` returned a fresh builder it would drop the model marker, and `.build()` after it
  // would be a compile error. That is the regression this asserts against.
  const _def = AgentBuilder.create()
    .model('m')
    .when(true, (chain) => chain.system('hi'))
    .tool(a)
    .build()
  expectTypeOf<InferAgentToolNames<typeof _def>>().toEqualTypeOf<'alpha'>()
}

// ── 5. `.tools()` enforces the SAME run-context guard as `.tool()` ────────────────────────────
{
  const rootTool = ContextualTool.of(
    { name: 'read_file' as const, description: 'reads', inputSchema: {}, handler: () => 'ok' },
    undefined as unknown as { projectRoot: string },
  )

  // The counter-proof that keeps this from being a hole. A batch API that quietly accepts what the
  // single-item API rejects is worse than no batch API — it would be the documented way to bypass
  // the check.
  // @ts-expect-error — the agent declares no run-context, so `read_file`'s requirement is unmet.
  AgentBuilder.create().model('m').tools([rootTool]).build()

  // And with the context declared, the same call is fine — otherwise the guard above would pass by
  // rejecting everything.
  const _ok = AgentBuilder.create()
    .context({ projectRoot: 'x' })
    .model('m')
    .tools([rootTool])
    .build()
  expectTypeOf<InferAgentToolNames<typeof _ok>>().toEqualTypeOf<'read_file'>()
}
