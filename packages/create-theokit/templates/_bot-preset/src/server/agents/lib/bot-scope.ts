import { deriveConversationId } from '@theokit/agents'
import { bindToolScope } from '@theokit/agents/tool-scope'
import type { SandboxProvider } from '@theokit/agents/sandbox'

/**
 * Everything one bot needs, per request, in one call.
 *
 * This is the piece a bot builder currently rediscovers. Three separate providers have to line up
 * for a bot to be isolated from its siblings, and each is documented somewhere else:
 *
 * - **conversation** — `deriveConversationId(resource, thread)` keeps one bot's history out of
 *   another's. Without it, two bots sharing a store read each other's turns.
 * - **tools** — `bindToolScope({ projectRoot, writeRoot, sandbox })` confines what the bot can
 *   touch. The sandbox is REQUIRED by that API on purpose: an omitted one used to produce an
 *   unconfined shell in silence.
 * - **workspace** — a directory per bot, so "confined" means confined to its own work and not to
 *   the whole app.
 *
 * Composing them here means a new bot is one call rather than three decisions, and — more to the
 * point — the isolation is the DEFAULT instead of something each bot has to remember.
 */
export interface BotScope {
  /** Pass to the run so this bot's history is its own. */
  readonly conversationId: string
  /** Pass to tools so this bot writes only inside its own workspace. */
  readonly tools: ReturnType<typeof bindToolScope>
  /** Where this bot's work lives on disk. */
  readonly workspace: string
}

export interface BotScopeInput {
  /** Which bot. Becomes the conversation `resource` and the workspace directory name. */
  readonly botId: string
  /**
   * Which thread of that bot's work — a ticket id, a channel, a schedule name. Defaults to
   * `'default'` so a single-threaded bot needs no ceremony.
   */
  readonly thread?: string
  /** The app root. Everything is derived under it. */
  readonly projectRoot: string
  /**
   * The confinement, required for the same reason `bindToolScope` requires it: a caller who wants
   * none must say so with a `danger-full-access` provider, which appears in a review. An omission
   * appears nowhere.
   */
  readonly sandbox: SandboxProvider
}

export function botScope(input: BotScopeInput): BotScope {
  const workspace = `${input.projectRoot}/.bots/${input.botId}`
  return {
    conversationId: deriveConversationId(input.botId, input.thread ?? 'default'),
    // `writeRoot` is the bot's own directory, not the project: a bot that can write anywhere in the
    // app is a bot that can edit its siblings' work, and nothing here asked for that.
    tools: bindToolScope({
      projectRoot: input.projectRoot,
      writeRoot: workspace,
      sandbox: input.sandbox,
    }),
    workspace,
  }
}
