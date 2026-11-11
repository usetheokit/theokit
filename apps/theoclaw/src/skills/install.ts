import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { MAX_PACKAGE_BYTES, PublishError, type SkillPackage } from './publish.js'
import { parseSkillMarkdown } from './registry.js'

/** OC-72: `theoclaw skills install <name>[@<version>]` downloads, verifies and installs a registry skill. */
export class InstallError extends PublishError {}

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export interface InstallOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The workspace; the skill lands in `<workspace>/skills/<name>/`. */
  readonly workspace: string
  readonly fetch?: typeof fetch
}

export interface VerifiedPackage {
  readonly registry: string
  readonly sha256: string
  readonly pkg: SkillPackage
}

/** Parses `name` or `name@version`. */
export function parseSkillRef(ref: string): { name: string; version: string | undefined } {
  const at = ref.indexOf('@')
  const name = at < 0 ? ref : ref.slice(0, at)
  const version = at < 0 ? undefined : ref.slice(at + 1)
  if (!SKILL_NAME.test(name) || (version !== undefined && !SEMVER.test(version))) {
    throw new InstallError(`"${ref}" is not a skill name or name@version`)
  }
  return { name, version }
}

function compareSemver(a: string, b: string): number {
  const pa = SEMVER.exec(a)
  const pb = SEMVER.exec(b)
  if (pa === null || pb === null) return 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d !== 0) return d
  }
  if (pa[4] === pb[4]) return 0
  if (pa[4] === undefined) return 1
  if (pb[4] === undefined) return -1
  return pa[4] < pb[4] ? -1 : 1
}

function registryBase(env: InstallOptions['env']): string {
  const raw = (env.THEOCLAW_SKILLS_REGISTRY ?? '').trim()
  if (raw === '') throw new InstallError('THEOCLAW_SKILLS_REGISTRY is not set')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new InstallError('THEOCLAW_SKILLS_REGISTRY is not a URL')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new InstallError('THEOCLAW_SKILLS_REGISTRY must be https (http only for loopback)')
  }
  return raw.replace(/\/+$/, '')
}

/** Safe relative path inside the skill folder, or a reason it is refused. */
function checkPath(path: unknown): string {
  if (
    typeof path !== 'string' ||
    path === '' ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '..' || part === '' || part === '.')
  ) {
    throw new InstallError(`refusing package file path ${JSON.stringify(path)}`)
  }
  return path
}

/** Downloads `name[@version]` and verifies the digest and the package's identity. Writes nothing. */
export async function downloadSkill(ref: string, options: InstallOptions): Promise<VerifiedPackage> {
  const { name, version: wanted } = parseSkillRef(ref)
  const registry = registryBase(options.env)
  const doFetch = options.fetch ?? fetch
  const get = async (url: string): Promise<Response> => {
    try {
      return await doFetch(url, { redirect: 'error' })
    } catch {
      throw new InstallError(`cannot reach the skills registry at ${registry}`)
    }
  }
  const listing = await get(`${registry}/v1/skills/${encodeURIComponent(name)}`)
  if (listing.status === 404) throw new InstallError(`no skill "${name}" in the registry`)
  if (listing.status !== 200) throw new InstallError(`the skills registry answered ${listing.status}`)
  let versions: { version: string; sha256: string }[]
  try {
    const body = (await listing.json()) as { versions?: { version?: unknown; sha256?: unknown }[] }
    versions = (body.versions ?? []).filter(
      (v): v is { version: string; sha256: string } => typeof v.version === 'string' && typeof v.sha256 === 'string',
    )
  } catch {
    throw new InstallError('the skills registry sent an unreadable listing')
  }
  let entry: { version: string; sha256: string } | undefined
  if (wanted !== undefined) {
    entry = versions.find((v) => v.version === wanted)
    if (entry === undefined) throw new InstallError(`no version ${wanted} of "${name}" in the registry`)
  } else {
    entry = versions.filter((v) => SEMVER.test(v.version)).sort((a, b) => compareSemver(b.version, a.version))[0]
    if (entry === undefined) throw new InstallError(`"${name}" has no installable version`)
  }
  const response = await get(
    `${registry}/v1/skills/${encodeURIComponent(name)}/${encodeURIComponent(entry.version)}/package`,
  )
  if (response.status !== 200) throw new InstallError(`the skills registry answered ${response.status} for the package`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_PACKAGE_BYTES * 2) throw new InstallError('the package is larger than the 1 MiB cap')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== entry.sha256.toLowerCase()) {
    throw new InstallError(`${name}@${entry.version} does not match the registry's sha256; nothing installed`)
  }
  let pkg: SkillPackage
  try {
    pkg = JSON.parse(bytes.toString('utf8')) as SkillPackage
  } catch {
    throw new InstallError('the package is not valid JSON')
  }
  if (pkg.name !== name || pkg.version !== entry.version || !Array.isArray(pkg.files)) {
    throw new InstallError(`the package is not ${name}@${entry.version}; nothing installed`)
  }
  return { registry, sha256, pkg }
}

/** Downloads, verifies and installs; resolves to the line to print. */
export async function installSkill(ref: string, options: InstallOptions): Promise<string> {
  const { registry, sha256, pkg } = await downloadSkill(ref, options)
  const files = new Map<string, Buffer>()
  let total = 0
  for (const file of pkg.files) {
    const path = checkPath(file?.path)
    if (typeof file.contentBase64 !== 'string' || files.has(path)) {
      throw new InstallError(`refusing package file ${JSON.stringify(path)}`)
    }
    const data = Buffer.from(file.contentBase64, 'base64')
    total += data.length
    if (total > MAX_PACKAGE_BYTES) throw new InstallError('the skill is larger than 1 MiB')
    files.set(path, data)
  }
  const skillMd = files.get('SKILL.md')
  if (skillMd === undefined) throw new InstallError('the package has no SKILL.md')
  const text = skillMd.toString('utf8')
  const parsed = parseSkillMarkdown(text, 'workspace')
  if (parsed === undefined) throw new InstallError('SKILL.md needs frontmatter with a name and a description')
  if (parsed.name !== pkg.name) throw new InstallError(`SKILL.md names "${parsed.name}", not "${pkg.name}"`)

  const skillsDir = resolve(options.workspace, 'skills')
  const target = join(skillsDir, pkg.name)
  await mkdir(skillsDir, { recursive: true })
  const temp = await mkdtemp(join(skillsDir, `.${pkg.name}-install-`))
  const backup = `${temp}.old`
  try {
    for (const [path, data] of files) {
      const dest = resolve(temp, path)
      if (!dest.startsWith(temp + sep)) throw new InstallError(`refusing package file path ${JSON.stringify(path)}`)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, data)
    }
    await writeFile(
      join(temp, '.origin.json'),
      `${JSON.stringify({ registry, name: pkg.name, version: pkg.version, sha256 }, null, 2)}\n`,
    )
    let hadOld = true
    await rename(target, backup).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      hadOld = false
    })
    try {
      await rename(temp, target)
    } catch (error) {
      if (hadOld) await rename(backup, target).catch(() => undefined)
      throw error
    }
    if (hadOld) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    await rm(temp, { recursive: true, force: true })
    throw error
  }
  return `Installed ${pkg.name}@${pkg.version} -> ${target}`
}
