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
    }
  }

  // Walk from the LEAST important end — the caller ordered the list, so the last entry is the one
  // they said matters least.
  const kept: InstructionSource[] = [...sources]
  const dropped: string[] = []
  let trimmed: string | undefined

  const lengthOf = (list: readonly InstructionSource[]): number =>
    [base, ...list.map((source) => source.content)].join(separator).length

  while (kept.length > 0 && lengthOf(kept) > options.maxChars) {
    const last = kept.at(-1)
    if (last === undefined) break

    // Before dropping it entirely, see whether trimming THIS source is enough. Half a source the
    // user wrote is worth more than none of it, and only the last one is ever cut — cutting several
    // would leave a composed prompt where nothing is complete.
    const withoutLast = kept.slice(0, -1)
    const room = options.maxChars - lengthOf(withoutLast) - separator.length
    if (room > 0 && trimmed === undefined) {
      kept[kept.length - 1] = { ...last, content: last.content.slice(0, room) }
      trimmed = last.name
      warn(
        `instruction budget: "${last.name}" was trimmed to ${String(room)} characters to fit the ` +
          `${String(options.maxChars)}-character ceiling.`,
      )
      break
    }

    kept.pop()
    dropped.push(last.name)
    warn(`instruction budget: "${last.name}" was dropped to fit the ceiling.`)
  }

  return {
    text: [base, ...kept.map((source) => source.content)].join(separator),
    dropped,
    ...(trimmed !== undefined && { trimmed }),
  }
}
