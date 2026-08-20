/**
 * Total order over strings by UTF-16 code unit — the ordering build-time output
 * must use.
 *
 * `localeCompare` is the wrong instrument here, and reads like the right one,
 * which is why it kept being chosen. With no locale argument it uses the default
 * collator, and Node derives that from `LC_ALL`/`LANG`: under `sv-SE` an `ä`
 * sorts after `z`, under `en-US` before `a`. A scanner ordering that way emits a
 * different manifest per machine — and where the order being emitted is an
 * execution order, it decides which middleware runs first
 * (usetheokit/theokit#346, usetheokit/theokit#351).
 *
 * What build output needs from a comparator is that it be total and stable.
 * Being alphabetical for a reader of one particular language is not a property
 * it needs, and is the one that costs reproducibility.
 *
 * Presentation code is the opposite case and should keep `localeCompare`: a list
 * a human reads should collate the way that human's language collates.
 *
 * @internal
 */
export function compareByCodeUnit(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
