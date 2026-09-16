import { SubAgent } from '@theokit/agents'

import type { ToolRegistry } from '../tools/index.js'

const ANALYST_TOOLS = ['read_file', 'list_dir', 'grep'] as const

/**
 * The analyst's SPEC, separated from its construction so it can be asserted.
 *
 * #80 — `SubAgent.create` returns `{ name, description, inputSchema, handler }`; the spec is closed
 * over inside the handler and is not reachable from the outside. That is not a detail: it is the
 * reason the defect this function's `withheldBuiltinTools` fixes survived a passing test suite for
 * as long as it did. The only instrument that could see the analyst's real catalog was the built
 * binary with a credential, so nothing in CI ever asked.
 *
 * The seam is the one `roles.ts` already uses for the same problem (B-061 — *"the seam that makes a
 * role's composition assertable without a credential"*), rather than a second convention: this
 * repository builds agents at three sites, and the assertable ones expose what they compose.
 */
export function analystSpec(parentModel: string, registry: ToolRegistry) {
  return {
    name: 'analyst',
    description:
      'Delegate a focused code/repo analysis question to a child agent. It reads files (read-only) and ' +
      'returns a concise, grounded summary. Use for "summarize how X works" / "what tools does Y expose" ' +
      'style sub-questions so the main thread stays focused.',
    instructions:
      'You are a focused code analyst. Answer the delegated question by READING the relevant files with ' +
      'your tools (read_file / list_dir / grep) — never guess. Return a concise, grounded summary with ' +
      'concrete evidence (file paths, names, counts). You cannot edit files or run commands.',
    model: parentModel,
    tools: registry.resolve([...ANALYST_TOOLS]),
    // #80 — the analyst says "You cannot edit files or run commands" two lines above, and until this
    // field existed it could. A `shell` tool is registered on every local agent whether or not the
    // caller asks — "including when you pass `tools: []`" (`LocalOptions` docblock) — so withholding
    // is the ONLY mechanism that removes it. Measured on the built binary: asked to enumerate its own
    // catalog, the analyst listed `shell` FIRST, while the test asserting its declared list went on
    // passing. The list was right; the catalog was not.
    //
    // Safe here in a way it would not be for a role that executes: `ANALYST_TOOLS` holds three read
    // tools and no shell of any kind, so nothing this agent was granted travels under this name. The
    // sibling `roles.ts` withholds the same builtin and keeps `run_shell`, which is this product's
    // own tool under a different name.
    withheldBuiltinTools: ['shell' as const],
    maxDelegationDepth: 2,
  }
}

export function createAnalystSubagent(parentModel: string, registry: ToolRegistry) {
  return SubAgent.create(analystSpec(parentModel, registry))
}
