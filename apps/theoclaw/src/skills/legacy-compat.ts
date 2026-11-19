import { readFile } from 'node:fs/promises'

import type { InlineSkill } from '@theokit/sdk'
import { discoverSkills, type Skill as SdkSkill } from '@theokit/sdk/skills'

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

/** The valid skills in `dirs` as the SDK discovers them: the first directory to hold a name wins. */
export async function discoverWinners(dirs: readonly string[]): Promise<SdkSkill[]> {
  const winners = new Map<string, SdkSkill>()
  for (const dir of dirs) for (const skill of await discoverSkills(dir)) if (!winners.has(skill.name)) winners.set(skill.name, skill)
  return [...winners.values()]
}

/**
 * Inline skills for the SDK-discovered `winners` whose file still says `requires:`. Each keeps
 * everything the SDK parsed (`disable-model-invocation` and the rest) and adds `requiresBins`, so the
 * SDK's own PATH gate applies; the file is read, never changed.
 */
export async function legacyRequiresSkills(winners: readonly SdkSkill[], warn: (message: string) => void = defaultWarn): Promise<InlineSkill[]> {
  const found: InlineSkill[] = []
  for (const skill of winners) {
    if (skill.requiresBins !== undefined) continue
    let parsed: ReturnType<typeof readSkillFile>
    try {
      parsed = readSkillFile(await readFile(skill.source, 'utf8'))
    } catch {
      continue
    }
    const requiresBins = (parsed?.fields.get('requires') ?? '').split(',').map((bin) => bin.trim()).filter((bin) => bin !== '')
    if (parsed === undefined || requiresBins.length === 0) continue
    if (!warned.has(skill.source)) {
      warned.add(skill.source)
      warn(`[theoclaw] ${skill.source}: the "requires:" key is deprecated and will stop working in the next release; rename it to "requires-bins:"`)
    }
    found.push({ ...skill, instructions: parsed.body, requiresBins })
  }
  return found
}
