import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseSkillMarkdown } from './registry.js'

/** OC-72: `theoclaw skills publish <dir>` uploads a skill folder to the skills registry. */
export const MAX_PACKAGE_BYTES = 1024 * 1024

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface SkillPackage {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly files: readonly { path: string; contentBase64: string }[]
}

/** A refusal with a message that is safe to print (it never holds the token). */
export class PublishError extends Error {}

/** `version` from the frontmatter; `parseSkillMarkdown` ignores it. */
export function readSkillVersion(text: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null) return undefined
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0 && line.slice(0, colon).trim() === 'version') {
      const value = line
        .slice(colon + 1)
        .trim()
        .replace(/^(["'])(.*)\1$/, '$2')
      return value === '' ? undefined : value
    }
  }
  return undefined
}

function collect(root: string, rel: string, out: { path: string; data: Buffer }[], total: { n: number }): void {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`
    const stat = lstatSync(join(root, path))
    if (stat.isSymbolicLink()) throw new PublishError(`${path} is a symbolic link; a skill holds regular files only`)
    if (stat.isDirectory()) collect(root, path, out, total)
    else if (stat.isFile()) {
      total.n += stat.size
      if (total.n > MAX_PACKAGE_BYTES) throw new PublishError('the skill folder is larger than 1 MiB')
      out.push({ path, data: readFileSync(join(root, path)) })
    } else throw new PublishError(`${path} is not a regular file`)
  }
}

/** Reads and validates a skill folder; throws `PublishError` before anything is sent. */
export function buildSkillPackage(dir: string): SkillPackage {
  let files: { path: string; data: Buffer }[] = []
  try {
    if (!lstatSync(dir).isDirectory()) throw new PublishError(`${dir} is not a directory`)
    collect(dir, '', files, { n: 0 })
  } catch (error) {
    if (error instanceof PublishError) throw error
    throw new PublishError(`cannot read ${dir}`)
  }
  files = files.sort((a, b) => (a.path < b.path ? -1 : 1))
  const skill = files.find((file) => file.path === 'SKILL.md')
  if (skill === undefined) throw new PublishError(`${dir} has no SKILL.md`)
  const text = skill.data.toString('utf8')
  const parsed = parseSkillMarkdown(text, 'workspace')
  if (parsed === undefined) throw new PublishError('SKILL.md needs frontmatter with a name and a description')
  if (!SKILL_NAME.test(parsed.name)) throw new PublishError(`invalid skill name "${parsed.name}"`)
  const version = readSkillVersion(text)
  if (version === undefined) throw new PublishError('SKILL.md frontmatter needs a version (semver) to publish')
  if (!SEMVER.test(version)) throw new PublishError(`version "${version}" is not semver`)
  return {
    name: parsed.name,
    version,
    description: parsed.description,
    files: files.map((file) => ({ path: file.path, contentBase64: file.data.toString('base64') })),
  }
}

export interface PublishOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly fetch?: typeof fetch
}

/** Publishes the folder; resolves to the line to print, throws `PublishError` otherwise. */
export async function publishSkill(dir: string, options: PublishOptions): Promise<string> {
  const registry = (options.env.THEOCLAW_SKILLS_REGISTRY ?? '').trim()
  const token = (options.env.THEOCLAW_SKILLS_TOKEN ?? '').trim()
  if (registry === '') throw new PublishError('THEOCLAW_SKILLS_REGISTRY is not set')
  if (token === '') throw new PublishError('THEOCLAW_SKILLS_TOKEN is not set')
  const pkg = buildSkillPackage(dir)
  const url = `${registry.replace(/\/+$/, '')}/v1/skills/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`
  const id = `${pkg.name}@${pkg.version}`
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(pkg),
    })
  } catch {
    throw new PublishError(`cannot reach the skills registry at ${registry}`)
  }
  if (response.status === 201) return `Published ${id}`
  if (response.status === 409) throw new PublishError(`${id} already exists`)
  if (response.status === 401) throw new PublishError('the skills registry rejected THEOCLAW_SKILLS_TOKEN (401)')
  if (response.status === 400) throw new PublishError(`the skills registry rejected ${id} as invalid (400)`)
  throw new PublishError(`the skills registry answered ${response.status}`)
}
