/**
 * M74 — compose a base prompt with instruction sources under a character ceiling.
 *
 * ## Why the truncation LADDER is mechanism and the ORDER is policy
 *
 * When the composed text does not fit, something has to go — and which thing goes is a product
 * decision. A coding agent drops repository conventions before user rules; a support agent may do
 * the opposite. Baking that preference into the framework would be absorbing one product's taste as
 * everyone's law, which is the milestone's named risk.
 *
 * So the caller passes `sources` ALREADY ORDERED, most important first, and this function walks that
 * order backwards when it needs room. The framework supplies the cutting mechanism; the product
 * supplies the preference. No source NAME appears in this file.
 *
 * ## Why it truncates rather than refusing
 *
 * A prompt that does not fit is a run that cannot start, and refusing outright would make a long
 * instruction file a hard failure at the worst moment. Dropping the least important source and
 * SAYING SO is the behaviour that keeps the agent usable while keeping the user informed — which is
 * why `onWarn` is not optional in practice even though it is optional in the signature.
 */

/** One named block of instructions the caller wants composed. */
export interface InstructionSource {
  /** The product's own label, used only in warnings. Never interpreted here. */
  readonly name: string
  readonly content: string
  /** How this source is cut when the budget is tight. Omitted behaves as `{ kind: 'drop' }`. */
  readonly trim?: InstructionTrim
  /**
   * Cut order under a tight budget: the LOWEST priority is cut first; an omitted priority counts as
   * 0, and ties cut the later-listed source first (so with no priorities the last listed goes
   * first, as before). The composed text keeps the listed order.
   */
  readonly priority?: number
}

/**
 * Per-source trim policy. `drop` (the default) is the original behaviour: the last source may keep
 * its head once, otherwise it is dropped whole.
 */
export type InstructionTrim =
  | { readonly kind: 'drop' }
  | { readonly kind: 'keep-head' }
  | { readonly kind: 'keep-tail' }
  | { readonly kind: 'blocks-from-start'; readonly separator: string }

/** Characters one source lost: `to` is 0 when it was dropped. Never zero-width. */
export interface InstructionCut {
  readonly name: string
  /** Characters before the cut. */
  readonly from: number
  /** Characters after the cut. */
  readonly to: number
}

export interface ComposeInstructionsOptions {
  /** Ceiling for the whole composed string, base included. */
  readonly maxChars: number
  /** Where a dropped or trimmed source is reported. Silence here loses the user's instructions. */
  readonly onWarn?: (message: string) => void
  /** Separator between blocks. */
  readonly separator?: string
}

export interface ComposedInstructions {
  readonly text: string
  /** Names of sources that were dropped entirely, in the order they were dropped. */
  readonly dropped: readonly string[]
  /** Name of the source that was cut in half to fit, when one was. */
  readonly trimmed?: string
  /** One entry per source that lost characters, in the order they were cut. Empty when all fit. */
  readonly cuts: readonly InstructionCut[]
}

const DEFAULT_SEPARATOR = '\n\n'

/** Named, so the default is a decision a reader can see rather than an empty pair of braces. */
const IGNORE_WARNING = (): void => undefined

/**
 * Compose `base` with `sources`, cutting from the END of the list until it fits.
 *
 * The base is never dropped: it is the agent's own identity, and an agent without it is a different
 * agent. If the base alone exceeds the ceiling the result is the base, TRUNCATED, with a warning —
 * returning an empty string would be a silent lobotomy, and throwing would make a long system prompt
 * an unrecoverable configuration error.
 */
export function composeInstructions(
  base: string,
  sources: readonly InstructionSource[],
  options: ComposeInstructionsOptions,
): ComposedInstructions {
  const warn = options.onWarn ?? IGNORE_WARNING
  const separator = options.separator ?? DEFAULT_SEPARATOR

  if (base.length >= options.maxChars) {
    warn(
      `instruction budget: the base prompt alone is ${String(base.length)} characters against a ` +
        `ceiling of ${String(options.maxChars)}. It was truncated and every source was dropped.`,
    )
    return {
      text: base.slice(0, options.maxChars),
      dropped: sources.map((source) => source.name),
      trimmed: 'base',
      cuts: sources
        .filter((source) => source.content.length > 0)
        .map((source) => ({ name: source.name, from: source.content.length, to: 0 })),
    }
  }

  // Walk from the LEAST important end — the caller ordered the list, so the last entry is the one
  // they said matters least.
  const kept: InstructionSource[] = [...sources]
  // The index of the source to cut next: lowest priority, later-listed first on a tie. Without any
  // priority this is the last entry — the original behaviour.
  const victim = (): number => {
    let at = kept.length - 1
    for (let i = kept.length - 2; i >= 0; i -= 1) {
      if ((kept[i]?.priority ?? 0) < (kept[at]?.priority ?? 0)) at = i
    }
    return at
  }
  const dropped: string[] = []
  let trimmed: string | undefined
  const cuts: InstructionCut[] = []
  const record = (name: string, from: number, to: number): void => {
    if (from !== to) cuts.push({ name, from, to })
  }

  const lengthOf = (list: readonly InstructionSource[]): number =>
    [base, ...list.map((source) => source.content)].join(separator).length

  while (kept.length > 0 && lengthOf(kept) > options.maxChars) {
    const at = victim()
    const last = kept.at(at)
    if (last === undefined) break

    // Before dropping it entirely, see whether trimming THIS source is enough. Half a source the
    // user wrote is worth more than none of it, and only the last one is ever cut — cutting several
    // would leave a composed prompt where nothing is complete.
    const withoutLast = kept.filter((_, i) => i !== at)
    const room = options.maxChars - lengthOf(withoutLast) - separator.length
    const policy = last.trim
    if (policy !== undefined && policy.kind !== 'drop') {
      const next = applyPolicy(last.content, policy, room)
      if (next !== undefined) {
        kept[at] = { ...last, content: next }
        record(last.name, last.content.length, next.length)
        trimmed ??= last.name
        warn(
          `instruction budget: "${last.name}" was trimmed to ${String(next.length)} characters to ` +
            `fit the ${String(options.maxChars)}-character ceiling.`,
        )
        break
      }
    } else if (room > 0 && trimmed === undefined) {
      kept[at] = { ...last, content: last.content.slice(0, room) }
      trimmed = last.name
      record(last.name, last.content.length, room)
      warn(
        `instruction budget: "${last.name}" was trimmed to ${String(room)} characters to fit the ` +
          `${String(options.maxChars)}-character ceiling.`,
      )
      break
    }

    kept.splice(at, 1)
    dropped.push(last.name)
    record(last.name, last.content.length, 0)
    warn(`instruction budget: "${last.name}" was dropped to fit the ceiling.`)
  }

  return {
    text: [base, ...kept.map((source) => source.content)].join(separator),
    dropped,
    ...(trimmed !== undefined && { trimmed }),
    cuts,
  }
}

/** The trimmed content, or undefined when the policy cannot make it fit (the source is dropped). */
function applyPolicy(
  content: string,
  policy: Exclude<InstructionTrim, { kind: 'drop' }>,
  room: number,
): string | undefined {
  if (room <= 0) return undefined
  if (content.length <= room) return content
  if (policy.kind === 'keep-head') return content.slice(0, room)
  if (policy.kind === 'keep-tail') return content.slice(content.length - room)
  if (policy.separator === '') return undefined
  const blocks = content.split(policy.separator)
  while (blocks.length > 0 && blocks.join(policy.separator).length > room) blocks.shift()
  return blocks.length === 0 ? undefined : blocks.join(policy.separator)
}
