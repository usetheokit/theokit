/**
 * Is this string a secret, or is it the thing a developer types when an error message asks for
 * 32 characters? (usetheokit/theokit#610)
 *
 * ## Why the previous answer was worse than none
 *
 * `assertProductionSecret` shipped with `PLACEHOLDER_PATTERN = /CHANGE_ME|demo[-_]|placeholder/i`.
 * Measured against 0.64.0 with `NODE_ENV=production`, all five of these booted:
 *
 * ```
 * ACCEPTED  "dev-only-session-secret-32-chars-min-xxxx"   ← a real app's fallback
 * ACCEPTED  "changemexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"    ← the pattern wants CHANGE_ME, not changeme
 * ACCEPTED  "devxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
 * ACCEPTED  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    ← forty identical characters
 * ACCEPTED  "test-secret00000000000000000000000000000"
 * ```
 *
 * The 32-character floor was the only condition that ever fired, and a placeholder long enough to
 * clear it is precisely what the floor's own error message asks a developer to produce. A guard
 * that runs and admits `aaaa…` is worse than an absent one: it retires the question.
 *
 * ## Shape
 *
 * Each rule is one object answering one question, and `inspectSecret` walks them in order and stops
 * at the first that fires. Adding a rule is adding an entry — no existing rule is edited, and the
 * caller's `switch` on `code` keeps working, because a new code only ever appears with a new rule.
 * The alternative (one function of stacked `if`s) is the shape the old check had, and it is why
 * widening it meant editing a regex nobody could read.
 *
 * ## What this deliberately does NOT do
 *
 * It does not compute Shannon entropy and call the number a security property. Entropy of a
 * 32-character sample is dominated by sampling noise — `openssl rand -hex 32` and
 * `passwordpassword1234567890abcdef` land close enough that a threshold between them would be
 * arbitrary. What separates them is not the number: it is the presence of a word a human chose.
 * So the vocabulary rule does the work, and the variety rule is only the net under it.
 */

/** Stable identifier for the rule that fired. Machine-readable so a caller can branch on it. */
export type SecretWeaknessCode = 'too_short' | 'placeholder' | 'low_variety' | 'repeated_pattern'

export interface SecretWeakness {
  /** Which rule refused the secret. */
  code: SecretWeaknessCode
  /**
   * One sentence a developer can act on.
   *
   * NEVER contains the secret or any fragment of it. The previous implementation put
   * `secret.slice(0, 16)` in its error message, and an error message travels into stdout, a crash
   * reporter and whatever aggregates them — publishing half the key to every system that was never
   * meant to hold it.
   */
  reason: string
}

/** The floor `normalizeSecrets` has always enforced, restated here so a rule owns it. */
export const MIN_SECRET_LENGTH = 32

/**
 * Distinct characters a secret must contain.
 *
 * Eight, and the number is a ceiling imposed by false positives rather than a wish. A hex secret of
 * 32 characters draws from an alphabet of 16, and the coupon-collector variance means it carries
 * ~14 distinct characters on average with a real tail below 12 — a floor of 12 would refuse roughly
 * one legitimate `openssl rand -hex 32` in fifty. At eight, the probability of a random hex secret
 * missing nine of sixteen symbols is negligible, while `devxxx…` (4) and `aaaa…` (1) are still
 * refused.
 *
 * A guard that fires on correct input is a guard somebody disables.
 */
const MIN_DISTINCT_CHARS = 8

/**
 * Words that do not occur in random output and do occur in strings people type.
 *
 * Five characters or more, so the odds of one appearing by chance in a random 64-character
 * base64 secret are on the order of 10⁻⁸. They are matched anywhere in the string.
 */
const PLACEHOLDER_TERMS: readonly RegExp[] = [
  /change[-_ ]?me/i,
  /placeholder/i,
  /\bsecret/i,
  /passw(or)?d/i,
  /insecure/i,
  /example/i,
  /sample/i,
  /dummy/i,
  /replace/i,
  /generate/i,
  /notasecret/i,
  /foobar/i,
  /hunter2/i,
  /lorem/i,
]

/**
 * Words too short to match anywhere without hitting random output by accident.
 *
 * `dev` inside a random base64 secret is a one-in-a-thousand event; `dev` at the start of the
 * string or after a separator is a decision somebody made. Requiring the boundary keeps the rule
 * on the side of the developer who did nothing wrong.
 */
const DELIMITED_PLACEHOLDER_TERMS: readonly string[] = [
  'dev',
  'test',
  'demo',
  'temp',
  'fake',
  'local',
  'mine',
  'todo',
  'none',
  'null',
  'key',
  'seed',
  'value',
  'here',
  'your',
  'xxx',
  'yyy',
  'zzz',
]

const WORD_CHARACTER = /[a-z0-9]/i

/** A character that would make an occurrence part of a longer run rather than a standalone term. */
function isWordCharacter(char: string | undefined): boolean {
  return char !== undefined && WORD_CHARACTER.test(char)
}

/**
 * Does `term` appear delimited — at a string edge, or between characters that are not letters or
 * digits?
 *
 * Written as a scan rather than as `new RegExp('(^|[^a-z0-9])' + term + …)` because building a
 * pattern from a variable is a habit that reads the same whether the variable is a constant in this
 * file or a string from a request, and only one of those is safe. The scan also compiles nothing
 * per call.
 */
function containsDelimitedTerm(secret: string, term: string): boolean {
  const haystack = secret.toLowerCase()
  for (let from = 0; from <= haystack.length - term.length; ) {
    const at = haystack.indexOf(term, from)
    if (at === -1) return false
    if (!isWordCharacter(haystack[at - 1]) && !isWordCharacter(haystack[at + term.length])) {
      return true
    }
    from = at + 1
  }
  return false
}

/** One question, asked of one secret. `null` means the rule is satisfied. */
interface SecretRule {
  readonly code: SecretWeaknessCode
  /** @returns the reason the secret is unusable, or `null` when this rule has no objection. */
  check(secret: string): string | null
}

/**
 * Order is contract, not taste.
 *
 * `too_short` speaks first so a short secret keeps the message it has always had — the length floor
 * predates every other rule and its wording is what existing tests and existing muscle memory read.
 * `low_variety` precedes `repeated_pattern` because `aaaa…` is more honestly described as having
 * one distinct character than as a period-1 repetition.
 */
const RULES: readonly SecretRule[] = [
  {
    code: 'too_short',
    check: (secret) =>
      secret.length < MIN_SECRET_LENGTH
        ? `is ${secret.length} characters; the minimum is ${MIN_SECRET_LENGTH}`
        : null,
  },
  {
    code: 'placeholder',
    check: (secret) => {
      const matched = PLACEHOLDER_TERMS.find((term) => term.test(secret))
      if (matched) {
        return `contains placeholder wording (matching ${String(matched)}); a generated secret contains no words`
      }
      const delimited = DELIMITED_PLACEHOLDER_TERMS.find((term) =>
        containsDelimitedTerm(secret, term),
      )
      if (delimited) {
        return `contains the placeholder word "${delimited}" as a standalone term; a generated secret contains no words`
      }
      return null
    },
  },
  {
    code: 'low_variety',
    check: (secret) => {
      const distinct = new Set(secret).size
      return distinct < MIN_DISTINCT_CHARS
        ? `uses only ${distinct} distinct characters; a generated secret of this length uses at least ${MIN_DISTINCT_CHARS}`
        : null
    },
  },
  {
    code: 'repeated_pattern',
    check: (secret) => {
      // `(s + s).indexOf(s, 1)` is the period of the string: for `abcabcabc` it answers 3, and for
      // a string that is not a repetition it answers `s.length`. Three repetitions or more is the
      // bar — two halves that happen to match is a coincidence a longer secret can survive.
      const period = (secret + secret).indexOf(secret, 1)
      return period > 0 && period * 3 <= secret.length
        ? `is a ${period}-character block repeated ${Math.round(secret.length / period)} times`
        : null
    },
  },
]

/**
 * Inspect a secret for the weaknesses a human introduces and a generator cannot.
 *
 * ```ts
 * const weakness = inspectSecret(process.env.SESSION_SECRET ?? '')
 * if (weakness) throw new Error(`SESSION_SECRET ${weakness.reason}`)
 * ```
 *
 * Exported because sessions are not the only place an app holds one: signing keys, webhook secrets
 * and API tokens read from the environment fail the same way, and an app that has this check for
 * its session cookie and not for its webhook signature has moved the hole rather than closed it.
 *
 * @param secret the value to inspect; never logged, never echoed into the result
 * @returns the first weakness found, or `null` when the secret survives every rule
 */
export function inspectSecret(secret: string): SecretWeakness | null {
  for (const rule of RULES) {
    const reason = rule.check(secret)
    if (reason !== null) return { code: rule.code, reason }
  }
  return null
}
