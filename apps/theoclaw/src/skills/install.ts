/** OC-72: `theoclaw skills install <name>[@<version>]` downloads, verifies and installs a registry skill. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { checkRegistryBase, RegistryError } from './registry-client.js'
import { parseSkillMarkdown } from './registry.js'

export const MAX_PACKAGE_BYTES = 1024 * 1024
const TIMEOUT_MS = 10_000
const NAME = /^[a-z0-9][a-z0-9._-]*$/i
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?$/i

export interface InstallOptions {
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

export interface PackageFile {
  readonly path: string
  readonly bytes: Buffer
}

export interface VerifiedPackage {
  readonly name: string
  readonly version: string
  readonly sha256: string
  readonly files: readonly PackageFile[]
}

function compareSemver(a: string, b: string): number {
  const pa = SEMVER.exec(a)
  const pb = SEMVER.exec(b)
  if (pa === null || pb === null) return a.localeCompare(b)
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d !== 0) return d
  }
  // A release outranks its prereleases.
  if (pa[4] === undefined) return pb[4] === undefined ? 0 : 1
  if (pb[4] === undefined) return -1
  return pa[4].localeCompare(pb[4])
}

async function get(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number,
  what: string,
): Promise<Response> {
  try {
    return await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    throw new RegistryError(`cannot reach the skills registry for ${what}`)
  }
}

async function readCapped(response: Response, max: number): Promise<Buffer> {
  const reader = response.body?.getReader()
  if (reader === undefined) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      throw new RegistryError('the skills registry response is too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new RegistryError('the skills registry answered something that is not JSON')
  }
}

/** A relative, forward-slash path that stays inside the folder it is joined to. */
function checkPath(path: unknown): string {
  if (
    typeof path !== 'string' ||
    path === '' ||
    path.includes('\\') ||
    path.includes('\0') ||
    isAbsolute(path) ||
    path.startsWith('/') ||
    /^[a-z]:/i.test(path) ||
    path.split('/').some((part) => part === '..' || part === '')
  )
    throw new RegistryError(`the package has an unsafe file path: ${String(path)}`)
  return path
}

/** Resolve the version, download the package and check it against the registry's digest. Nothing is written. */
export async function downloadSkill(
  base: string,
  name: string,
  wanted: string | undefined,
  options: InstallOptions = {},
): Promise<VerifiedPackage> {
  const root = checkRegistryBase(base).href.replace(/\/+$/, '')
  if (!NAME.test(name)) throw new RegistryError(`not a valid skill name: ${name}`)
  const fetcher = options.fetch ?? fetch
  const timeout = options.timeoutMs ?? TIMEOUT_MS
  const listing = await get(fetcher, `${root}/v1/skills/${encodeURIComponent(name)}`, timeout, name)
  if (listing.status === 404) throw new RegistryError(`the skills registry has no skill ${name}`)
  if (!listing.ok) throw new RegistryError(`the skills registry answered ${listing.status}`)
  const meta = parseJson(await readCapped(listing, MAX_PACKAGE_BYTES)) as {
    versions?: unknown
  } | null
  const versions = Array.isArray(meta?.versions)
    ? (meta.versions as Record<string, unknown>[]).filter(
        (v) => typeof v?.version === 'string' && typeof v.sha256 === 'string',
      )
    : []
  const chosen =
    wanted === undefined
      ? [...versions].sort((a, b) => compareSemver(String(b.version), String(a.version)))[0]
      : versions.find((v) => v.version === wanted)
  if (chosen === undefined)
    throw new RegistryError(
      wanted === undefined
        ? `the skills registry lists no version of ${name}`
        : `the skills registry has no version ${wanted} of ${name}`,
    )
  const version = String(chosen.version)
  const sha256 = String(chosen.sha256).toLowerCase()
  if (!SEMVER.test(version))
    throw new RegistryError(`the registry lists an invalid version: ${version}`)
  const res = await get(
    fetcher,
    `${root}/v1/skills/${encodeURIComponent(name)}/${encodeURIComponent(version)}/package`,
    timeout,
    `${name}@${version}`,
  )
  if (!res.ok)
    throw new RegistryError(`the skills registry answered ${res.status} for ${name}@${version}`)
  const bytes = await readCapped(res, MAX_PACKAGE_BYTES)
  if (createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new RegistryError(
      `${name}@${version} does not match the registry's sha256; not installed`,
    )
  const pkg = parseJson(bytes) as {
    name?: unknown
    version?: unknown
    files?: unknown
  } | null
  if (pkg?.name !== name || pkg.version !== version)
    throw new RegistryError(`the package is not ${name}@${version}; not installed`)
  if (!Array.isArray(pkg.files) || pkg.files.length === 0)
    throw new RegistryError('the package has no files')
  const seen = new Set<string>()
  let total = 0
  const files: PackageFile[] = []
  for (const f of pkg.files as Record<string, unknown>[]) {
    const path = checkPath(f?.path)
    if (typeof f.contentBase64 !== 'string' || seen.has(path))
      throw new RegistryError(`the package has an invalid or repeated file: ${path}`)
    seen.add(path)
    const content = Buffer.from(f.contentBase64, 'base64')
    total += content.byteLength
    if (total > MAX_PACKAGE_BYTES) throw new RegistryError('the package is too large')
    files.push({ path, bytes: content })
  }
  const skill = files.find((f) => f.path === 'SKILL.md')
  const parsed =
    skill === undefined ? undefined : parseSkillMarkdown(skill.bytes.toString('utf8'), 'workspace')
  if (parsed === undefined) throw new RegistryError('the package has no valid SKILL.md')
  if (parsed.name !== name)
    throw new RegistryError(`SKILL.md is named ${parsed.name}, not ${name}; not installed`)
  return { name, version, sha256, files }
}

/**
 * Write a verified package to `<skillsDir>/<name>/` through a temp sibling renamed into place, so a
 * failure leaves no half-written folder and keeps a previously installed version.
 */
export async function writeSkill(
  skillsDir: string,
  pkg: VerifiedPackage,
  registry: string,
): Promise<string> {
  const target = resolve(skillsDir, pkg.name)
  await mkdir(skillsDir, { recursive: true })
  const temp = await mkdtemp(join(skillsDir, `.${pkg.name}-`))
  const backup = `${temp}.old`
  try {
    for (const file of pkg.files) {
      const out = resolve(temp, file.path)
      if (!out.startsWith(temp + sep)) throw new RegistryError(`unsafe file path: ${file.path}`)
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, file.bytes)
    }
    await writeFile(
      join(temp, '.origin.json'),
      `${JSON.stringify({ registry, name: pkg.name, version: pkg.version, sha256: pkg.sha256 }, null, 2)}\n`,
    )
    const hadOld = await rename(target, backup).then(
      () => true,
      () => false,
    )
    try {
      await rename(temp, target)
    } catch (error) {
      if (hadOld) await rename(backup, target)
      throw error
    }
    if (hadOld) await rm(backup, { recursive: true, force: true })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
  return target
}

export async function installSkill(
  base: string,
  skillsDir: string,
  spec: string,
  options: InstallOptions = {},
): Promise<{ name: string; version: string; dir: string }> {
  const at = spec.indexOf('@')
  const name = at < 0 ? spec : spec.slice(0, at)
  const wanted = at < 0 ? undefined : spec.slice(at + 1)
  if (wanted === '') throw new RegistryError(`no version after @ in ${spec}`)
  const pkg = await downloadSkill(base, name, wanted, options)
  const dir = await writeSkill(skillsDir, pkg, base)
  return { name: pkg.name, version: pkg.version, dir }
}
