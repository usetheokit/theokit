/**
 * Refusing the runtime builtin `shell` at CALL time — a backstop, not the mechanism.
 *
 * The chat agent withholds the builtin at composition (`.withholdBuiltinTools(['shell'])` in
 * `chat/chat.ts`, #1913), so its schema is not declared to the model and no round is spent
 * discovering a refusal. This veto remains for the case where the tool is declared anyway (a
 * re-introduced builtin, another composition path): the builtin does not go through the project's
 * sandbox scope, so letting it run would leave an unsandboxed shell reachable (the failure B-017
 * recorded). Deleting it is only safe if every path is shown not to declare the tool.
 */
import type { HookHandlers } from '@theokit/agents'

const BUILTIN_SHELL = 'shell'

const VETO_REASON =
  `The '${BUILTIN_SHELL}' tool (a runtime builtin) is not used by this agent: it does not go through ` +
  "the project's sandbox scope, so a write through it would ignore `--sandbox read-only` and the " +
  '`writeRoot` of `workspace-write`. Use `Bash`, which does the same confined by the active policy.'

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
