/**
 * Split a markdown file into frontmatter lines and body.
 *
 * ## Why this is shared rather than duplicated
 *
 * Two loaders need it — the M74 instruction tree and the M76 command loader — and they need the SAME
 * answer to the same question: where does the metadata stop and the content begin, and what happens
 * when the fence never closes. That is one piece of knowledge (`G12`), not two similar-looking
 * functions.
 *
 * What is NOT shared is which KEYS each loader reads. `paths:` matters to instructions and
 * `description:` matters to commands, and folding those together would build a vocabulary neither
 * one asked for.
 */

/** Delimiter of a YAML-ish frontmatter block. */
const FENCE = '---'

export interface ParsedFrontmatter {
  /** Lines between the fences, excluding them. Empty when the file has no frontmatter. */
  readonly frontmatter: readonly string[]
  /** Everything after the closing fence — or the whole file when there is no frontmatter. */
  readonly body: string
}

/**
 * Split `raw`, or return `undefined` when the frontmatter opens and never closes.
 *
 * `undefined` rather than a best guess: a file whose fence never closes is malformed in a way that
 * makes its metadata unknowable, and guessing whether the rest is body or metadata feeds the caller
 * either the wrong text or the wrong settings. Both callers treat that as "skip this file, warn,
 * keep going" — failure is per file, never per tree.
 */
export function splitFrontmatter(raw: string): ParsedFrontmatter | undefined {
  const lines = raw.split('\n')
  if (lines[0]?.trim() !== FENCE) return { frontmatter: [], body: raw }

  const closing = lines.indexOf(FENCE, 1)
  if (closing === -1) return undefined

  return { frontmatter: lines.slice(1, closing), body: lines.slice(closing + 1).join('\n') }
}

/**
 * Read one scalar key from frontmatter lines.
 *
 * Deliberately not a YAML parser. Both callers read a handful of known keys, and pulling in a parser
 * to do that would be a dependency for a feature nobody asked for (parsimony rungs 4 → 1). An
 * unrecognised key is ignored rather than rejected — a product may put its own metadata there.
 */
export function frontmatterValue(frontmatter: readonly string[], key: string): string | undefined {
  const prefix = `${key}:`
  for (const line of frontmatter) {
    if (!line.startsWith(prefix)) continue
    const value = line.slice(prefix.length).trim()
    // Strip matching quotes only — an unbalanced quote is more likely part of the value than a
    // delimiter, and eating it would silently change what the user wrote.
    const unquoted = /^(["'])(.*)\1$/.exec(value)
    return unquoted?.[2] ?? value
  }
  return undefined
}
