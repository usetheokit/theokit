import type { AgentOutputEvent } from '../agent-output-event.js'
import type { Presenter } from '../presenter.js'

/**
 * The chat surface — the fourth `Presenter`, beside `ui-message-stream`, `terminal` and `json`.
 *
 * ## Why this exists rather than a loop in the app
 *
 * The defect it closes was observed on a real phone: a reply arrived as `"TheOi! 👋"`, the `"The"`
 * being a fragment of the model's reasoning, because a hand-written loop took every frame carrying
 * a delta. `AgentOutputEvent` is a discriminated union of EIGHT variants and this file switches over
 * it, so the compiler refuses to let a variant be forgotten. The guarantee is structural, not
 * disciplinary — that is the whole argument for a presenter here.
 *
 * ## It emits ONE message, and never splits
 *
 * A chat message is not a stream: the surface has no line to rewrite. So the presenter assembles
 * across `present()` calls and emits once on `finish()`.
 *
 * It also never splits, and that is a decision with evidence behind it (`B-019` ADR D1): all eight
 * gateway splitters already split inside `sendMessage`, so a presenter that pre-split would produce
 * a double-split — one that is a no-op almost always and changes behaviour only when a chunk lands
 * exactly on the boundary, in production, with no signal from either side. Length is the adapter's
 * decision and always was.
 *
 * ## It knows nothing about any platform
 *
 * Dialect translation is INJECTED (`translate`). The presenter never imports a gateway package, so
 * `@theokit/presenter` keeps `dependencies: {}` and the framework does not acquire a dependency on
 * a package from another repository. `OutboundMessage` is matched structurally for the same reason:
 * TypeScript is structural, and `{ channel, text, format? }` satisfies the gateway's type without
 * either package knowing about the other.
 *
 * `@theokit/gateway` exports `toDialect(text, platform)` for callers that want it — that is the
 * intended pairing, done by the composition root rather than by this file.
 */

/** Where the message goes. Structurally compatible with `OutboundMessage["channel"]`. */
export interface ChatChannel {
  readonly id: string
  readonly type: 'dm' | 'group' | 'thread'
  readonly topicId?: string
}

/** What this presenter emits. Structurally compatible with `@theokit/gateway`'s `OutboundMessage`. */
export interface ChatMessage {
  readonly channel: ChatChannel
  readonly text: string
  readonly format?: 'plain' | 'markdown' | 'html'
  readonly replyTo?: string
}

/** How one chat presenter is built. Everything but `channel` has a conservative default. */
export interface ChatPresenterOptions {
  readonly channel: ChatChannel
  /**
   * Rewrite the assembled text for the destination — typically `@theokit/gateway`'s
   * `toDialect(text, platform)` bound to one platform. Identity when absent.
   */
  readonly translate?: (text: string) => string
  /** The rendering hint carried on the message. Defaults to `markdown`. */
  readonly format?: 'plain' | 'markdown' | 'html'
  /**
   * What the user is told when the run fails.
   *
   * A fixed sentence on purpose: `AgentErrorEvent` carries `message` and `code`, and both may hold
   * internal detail — a connection string, an upstream stack, a secret in a URL. Silence is not the
   * alternative: on a channel it is indistinguishable from an agent that ignored the person.
   */
  readonly onError?: string
  /** Reply threading, when the surface supports it. */
  readonly replyTo?: string
}

const DEFAULT_ERROR = 'Something went wrong on my side and I could not finish that.'

/**
 * `Presenter<ChatMessage>` — assembles a turn into one chat message.
 *
 * Stateful, so it is instantiated PER STREAM, like the web presenter and unlike terminal/json.
 *
 * @public
 */
export class ChatPresenter implements Presenter<ChatMessage> {
  readonly surface = 'chat'

  readonly #options: ChatPresenterOptions
  #text = ''
  #failed = false

  constructor(options: ChatPresenterOptions) {
    this.#options = options
  }

  /**
   * Translate one event.
   *
   * Returns nothing for every event except `finish`: a chat surface has no partial message to
   * update, so there is nothing to emit until the turn is over.
   */
  present(event: AgentOutputEvent): ChatMessage[] {
    switch (event.type) {
      case 'text':
        this.#text += event.text
        return []

      // The model's thinking, and the arguments of a tool call as they stream. Neither is addressed
      // to the user. `reasoning` is the `"TheOi!"` defect; `partial-tool-call` has no meaning where
      // there is no line being rewritten.
      case 'reasoning':
      case 'partial-tool-call':
        return []

      // Presence, not content. Whether a chat surface should show "looking up the weather…" is a
      // product decision and the conservative default is no: each one costs a second message, and
      // adding them later breaks nothing.
      case 'tool-call':
      case 'tool-result':
      case 'status':
        return []

      case 'error':
        this.#failed = true
        return []

      case 'finish':
        return this.#emit()
    }
  }

  /** Emit whatever the turn produced, or nothing when it produced neither text nor a failure. */
  #emit(): ChatMessage[] {
    const translate = this.#options.translate ?? ((t: string): string => t)
    const body =
      this.#failed && this.#text.length === 0
        ? (this.#options.onError ?? DEFAULT_ERROR)
        : translate(this.#text)

    this.#text = ''
    this.#failed = false

    if (body.length === 0) return []

    return [
      {
        channel: this.#options.channel,
        text: body,
        ...(this.#options.format === undefined
          ? { format: 'markdown' as const }
          : { format: this.#options.format }),
        ...(this.#options.replyTo === undefined ? {} : { replyTo: this.#options.replyTo }),
      },
    ]
  }
}
