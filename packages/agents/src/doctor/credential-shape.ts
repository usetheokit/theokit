/**
 * Names what is wrong with a credential's shape without ever echoing the credential.
 * A pasted key with a trailing newline, quotes or a placeholder is the most common
 * configuration failure; the description is safe to paste into an issue.
 */
export type CredentialDefect =
  | 'edge_whitespace'
  | 'inner_whitespace'
  | 'quote_or_backslash'
  | 'control_character'
  | 'placeholder'
  | 'too_short'

const PLACEHOLDER = /^(changeme|change-me|your[-_ ].*|xxx+|<.*>|\.\.\.|todo|none|null|undefined)$/i
const DEFAULT_MIN_LENGTH = 8

/** The first defect found, in the order edge whitespace, inner whitespace, quote, control, placeholder, length. */
export function credentialShape(
  value: string,
  options: { minLength?: number } = {},
): 'ok' | CredentialDefect {
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH
  if (value !== value.trim()) return 'edge_whitespace'
  if (/\s/.test(value)) return 'inner_whitespace'
  if (/["'`\\]/.test(value)) return 'quote_or_backslash'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return 'control_character'
  if (PLACEHOLDER.test(value)) return 'placeholder'
  if (value.length < minLength) return 'too_short'
  return 'ok'
}

/** A fixed sentence per defect; it never contains the value. */
export function describeCredentialDefect(
  defect: CredentialDefect,
  minLength: number = DEFAULT_MIN_LENGTH,
): string {
  switch (defect) {
    case 'edge_whitespace':
      return 'has leading or trailing whitespace'
    case 'inner_whitespace':
      return 'contains whitespace'
    case 'quote_or_backslash':
      return 'contains a quote or backslash'
    case 'control_character':
      return 'contains a control character'
    case 'placeholder':
      return 'is a placeholder'
    case 'too_short':
      return `is shorter than ${minLength} characters`
  }
}
