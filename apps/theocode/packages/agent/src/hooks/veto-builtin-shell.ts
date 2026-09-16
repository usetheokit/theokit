/**
 * Blocking the runtime builtin `shell` at CALL time, because there is nowhere to withhold it.
 *
 * ## This is a backstop doing a primary's job, and that costs real money
 *
 * Declaring a tool and then refusing every call to it is the wrong shape. The model is told `shell`
 * exists, so it can choose it — and burn a whole round discovering it is refused — and the schema
 * is re-sent on every round whether it is chosen or not. Measured 2026-08-25 against
 * `@theokit/sdk@4.53.1`: 267 characters per round, inside a tool surface that already costs more
 * than the system prompt.
 *
 * ## Why it is not fixed at composition time instead
 *
 * Because the SDK gives no seam to fix it at. Verified in the installed build, not inferred:
 *
 *  - `collectTools(mcp, sink)` prepends the `shell` descriptor UNCONDITIONALLY. It takes no options
 *    and consults no config, so there is no flag to turn it off.
 *  - The tool list reaches the provider as `tools: ctx.tools.map(toLlmTool)` — no filter stands
 *    between the array and the wire.
 *  - `AgentOptions` has no `disallowedTools` / `builtinTools` / equivalent. `ForkOptions.allowedTools`
 *    is the nearest thing and is both fork-only and enforced at EXECUTION ("Tool blocked by fork
 *    whitelist"), so it would not shrink the declared set even if it applied here.
 *  - Shadowing it with our own scope-bound tool is refused by construction:
 *    `RESERVED_TOOL_NAMES = {shell, memory_search, memory_get}` makes a custom tool of that name
 *    throw `ConfigurationError(tool_reserved_name)`.
 *
 * So the veto stays, and stays PRIMARY, until the SDK can withhold a builtin from the declared set.
 * If it ever can, this should become what its name suggests — a backstop for a re-introduced tool —
 * and the tool should be dropped at composition instead. Until then, deleting this leaves an
 * unsandboxed shell reachable, which is the failure B-017 recorded.
 */
import type { HookHandlers } from '@theokit/agents'

const BUILTIN_SHELL = 'shell'

const VETO_REASON =
  `The '${BUILTIN_SHELL}' tool (a runtime builtin) is not used by this agent: it does not go through ` +
  "the project's sandbox scope, so a write through it would ignore `--sandbox read-only` and the " +
  '`writeRoot` of `workspace-write`. Use `run_shell`, which does the same confined by the active policy.'

export function withBuiltinShellVeto(handlers: HookHandlers): HookHandlers {
  const previous = handlers.pre_tool_call
  return {
    ...handlers,
    pre_tool_call: async (ctx) => {
      if ((ctx.name ?? '') === BUILTIN_SHELL) {
        return { block: true, message: VETO_REASON }
      }
      return previous === undefined ? undefined : await previous(ctx)
    },
  }
}
