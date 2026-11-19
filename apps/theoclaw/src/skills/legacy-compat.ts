import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type InlineSkill, Skill } from '@theokit/sdk'

/**
 * One release of compatibility for the old `requires: a, b` frontmatter key. The SDK reads only
 * `requires-bins`, so a skill file that still says `requires:` would be offered without its binary
 * gate. Each such file gets a warning that names it and an inline skill carrying the binaries; the
 * file itself is not touched. Discovery, precedence and the PATH gate stay with the SDK.
 */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
const warned = new Set<string>()

/** The frontmatter fields and body of a SKILL.md; undefined without frontmatter. Also vets packages in `skills install` and `skills publish`. */
export function readSkillFile(text: string): { fields: Map<string, string>; body: string } | undefined {
  const match = FRONTMATTER.exec(text)
  if (match === null) return undefined
  const fields = new Map<string, string>()
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  return { fields, body: (match[2] ?? '').trim() }
}

/** The name and description a package's SKILL.md declares; undefined when either is missing. */
export function skillHeader(text: string): { name: string; description: string } | undefined {
  const name = readSkillFile(text)?.fields.get('name')
  const description = readSkillFile(text)?.fields.get('description')
  return name === undefined || name === '' || description === undefined || description === '' ? undefined : { name, description }
}

const defaultWarn = (message: string): void => {
  process.stderr.write(`${message}\n`)
}

/** Inline skills for the skills in `dirs` (highest precedence first) that still use `requires:`. */
export function legacyRequiresSkills(dirs: readonly string[], warn: (message: string) => void = defaultWarn): InlineSkill[] {
  const seen = new Set<string>()
  const found: InlineSkill[] = []
  for (const dir of dirs) {
    let children: string[]
    try {
      children = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      continue
    }
    for (const child of children) {
      const file = join(dir, child, 'SKILL.md')
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const parsed = readSkillFile(text)
      if (parsed === undefined) continue
      const { fields, body } = parsed
      const name = fields.get('name') || child
      const first = !seen.has(name)
      seen.add(name)
      const legacy = fields.get('requires')
      const description = fields.get('description')
      if (!first || legacy === undefined || fields.has('requires-bins') || description === undefined || description === '') continue
      if (!warned.has(file)) {
        warned.add(file)
        warn(`[theoclaw] ${file}: the "requires:" key is deprecated and will stop working in the next release; rename it to "requires-bins:"`)
      }
      const requiresBins = legacy.split(',').map((bin) => bin.trim()).filter((bin) => bin !== '')
      found.push({ ...Skill.create({ name, description, instructions: body }), requiresBins })
    }
  }
  return found
}
