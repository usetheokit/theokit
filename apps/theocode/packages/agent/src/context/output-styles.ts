/**
 * Output styles — Claude Code's feature, read from Claude Code's directories.
 *
 * Format measured against `code.claude.com/docs/en/output-styles.md` on 2026-09-07: `.md` files
 * under `~/.claude/output-styles/` and `<project>/.claude/output-styles/`, frontmatter `name`
 * (defaulting to the filename), `description`, and `keep-coding-instructions`.
 *
 * **That last key defaults to FALSE, so a style REPLACES the built-in coding instructions.** It is
 * the one fact here worth stating twice: getting it backwards turns every style into a no-op with a
 * suffix — the built-in instructions stay, the operator's text is appended, and nothing they asked
 * to remove is gone. They would have to read the composed system prompt to find out.
 *
 * ## Why the operator's `~/.claude/` IS read here
 *
 * `context/user-skills.ts` deliberately does NOT read `~/.claude/skills/`, and `role-discovery.ts`
 * does not read `~/.claude/agents/`. This reads `~/.claude/output-styles/`, and the asymmetry is the
 * rule B-156 states rather than an oversight: a foreign root under the operator's home may
 * contribute text that CONSTRAINS the agent, but not artifacts that ADD INVOKABLE SURFACE. An output
 * style is text that constrains — the same side of the line as `~/.claude/rules/`. A skill or a role
 * is a name in a popup and a body that becomes a prompt, which is the other side.
 *
 * The frontmatter split is the framework's (`splitFrontmatter`, `frontmatterValue`), not a second
 * parser written here — the failure `user-skills.ts` records is a local splitter that keeps working
 * until the format moves, and then silently feeds the frontmatter into the prompt as body.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'

import { frontmatterValue, splitFrontmatter } from '@theokit/agents/config'

export interface OutputStyle {
  readonly name: string
  readonly description: string | undefined
  /** The body, with the frontmatter removed and the edges trimmed. */
  readonly instructions: string
  /** `keep-coding-instructions: true` — append rather than replace. DEFAULT FALSE. */
  readonly keepCodingInstructions: boolean
}

/** Claude Code's directory, in both roots. This product has no second name for the feature. */
const STYLE_DIR = join('.claude', 'output-styles')

function stylesIn(root: string): OutputStyle[] {
  const dir = join(root, STYLE_DIR)
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    // An unreadable directory is the ordinary case for a permission mistake, and refusing to start
    // over it would be worse than starting without a style the operator can then ask for by name.
    return []
  }
  const out: OutputStyle[] = []
  for (const entry of entries) {
    if (extname(entry) !== '.md') continue
    const parsed = readStyle(join(dir, entry))
    if (parsed !== null) out.push(parsed)
  }
  return out
}

function readStyle(path: string): OutputStyle | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const split = splitFrontmatter(raw)
  // `undefined` means the frontmatter opened and never closed, which makes the metadata unknowable
  // and the body a guess. Skipping is what the framework's own callers do — never per tree.
  if (split === undefined) return null
  return {
    name: frontmatterValue(split.frontmatter, 'name') ?? basename(path, '.md'),
    description: frontmatterValue(split.frontmatter, 'description'),
    instructions: split.body.trim(),
    keepCodingInstructions:
      frontmatterValue(split.frontmatter, 'keep-coding-instructions')?.trim().toLowerCase() ===
      'true',
  }
}

/**
 * The style named `name`, or null when nothing declares it.
 *
 * The project wins a name collision: it is the more specific context, it is what Claude Code's own
 * precedence does, and it is the rule this product already applies to skills and roles.
 */
export function loadOutputStyle(
  name: string,
  opts: { home?: string; project: string },
): OutputStyle | null {
  const home = opts.home ?? homedir()
  const byName = new Map<string, OutputStyle>()
  for (const style of [...stylesIn(home), ...stylesIn(opts.project)]) byName.set(style.name, style)
  return byName.get(name) ?? null
}

/**
 * The instructions a style produces, given the built-in ones.
 *
 * No style leaves the built-in text EXACTLY as it was — not trimmed, not re-wrapped. A composition
 * function that touches the input when it has nothing to do is a function whose no-op case has to be
 * tested for damage.
 */
export function applyOutputStyle(builtIn: string, style: OutputStyle | null): string {
  if (style === null) return builtIn
  if (style.keepCodingInstructions) return `${builtIn}\n\n${style.instructions}`
  return style.instructions
}
