import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import { join } from 'node:path'

import { parseSkillMarkdown } from './registry.js'

/**
 * OC-72: a reference skill registry. Packages live as `<dir>/<name>/<version>.json`, the exact bytes
 * published (versions are immutable, so a second publish fails on the exclusive create).
 */
export const MAX_PACKAGE_BYTES = 1024 * 1024
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export interface SkillsRegistryOptions {
  readonly dir: string
  readonly token: string
}

function send(res: ServerResponse, status: number, body: unknown, raw?: Buffer): void {
  const payload = raw ?? Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': payload.length })
  res.end(payload)
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** What is wrong with a package (undefined when valid). */
function validatePackage(text: string, name: string, version: string): string | undefined {
  let pkg: unknown
  try {
    pkg = JSON.parse(text)
  } catch {
    return 'the package is not JSON'
  }
  if (typeof pkg !== 'object' || pkg === null) return 'the package is not an object'
  const p = pkg as Record<string, unknown>
  if (p['name'] !== name) return 'package name differs from the URL'
  if (p['version'] !== version) return 'package version differs from the URL'
  if (typeof p['description'] !== 'string') return 'description must be a string'
  if (!Array.isArray(p['files'])) return 'files must be an array'
  let skillMd: string | undefined
  for (const file of p['files'] as unknown[]) {
    const f = file as { path?: unknown; contentBase64?: unknown } | null
    if (
      typeof f !== 'object' ||
      f === null ||
      typeof f.path !== 'string' ||
      typeof f.contentBase64 !== 'string'
    ) {
      return 'each file needs a path and contentBase64'
    }
    const path = f.path
    if (path === '' || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path))
      return `bad path ${path}`
    if (path.split('/').some((part) => part === '..' || part === '')) return `bad path ${path}`
    if (path === 'SKILL.md') skillMd = Buffer.from(f.contentBase64, 'base64').toString('utf8')
  }
  if (skillMd === undefined) return 'SKILL.md is missing'
  const entry = parseSkillMarkdown(skillMd, 'bundled')
  if (entry === undefined) return 'SKILL.md does not parse'
  if (entry.name !== name) return 'SKILL.md name differs from the package name'
  return undefined
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_PACKAGE_BYTES) return undefined
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

function tokenOk(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false
  const given = createHash('sha256').update(header.slice(7)).digest()
  return timingSafeEqual(given, createHash('sha256').update(token).digest())
}

export function createSkillsRegistryHandler(options: SkillsRegistryOptions): RequestListener {
  const { dir, token } = options
  mkdirSync(dir, { recursive: true })

  const versionsOf = (name: string): string[] => {
    try {
      return readdirSync(join(dir, name))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .filter((v) => SEMVER.test(v))
        .sort(compareVersions)
    } catch {
      return []
    }
  }
  const read = (name: string, version: string): Buffer =>
    readFileSync(join(dir, name, `${version}.json`))
  const describe = (name: string, versions: string[]): string => {
    const latest = versions[versions.length - 1]
    return latest === undefined
      ? ''
      : String(
          (JSON.parse(read(name, latest).toString('utf8')) as { description?: unknown })
            .description ?? '',
        )
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.split('/').filter((s) => s !== '')
    if (parts[0] !== 'v1' || parts[1] !== 'skills') return send(res, 404, { error: 'not found' })
    const [, , name, version, tail] = parts
    if (name !== undefined && !NAME.test(name))
      return send(res, req.method === 'PUT' ? 400 : 404, { error: 'bad name' })

    if (req.method === 'GET' && name === undefined) {
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const skills = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !NAME.test(entry.name)) continue
        const versions = versionsOf(entry.name)
        if (versions.length === 0) continue
        const description = describe(entry.name, versions)
        if (q !== '' && !entry.name.includes(q) && !description.toLowerCase().includes(q)) continue
        skills.push({
          name: entry.name,
          description,
          latest: versions[versions.length - 1],
          versions,
        })
      }
      skills.sort((a, b) => a.name.localeCompare(b.name))
      return send(res, 200, { skills })
    }
    if (req.method === 'GET' && name !== undefined && version === undefined) {
      const versions = versionsOf(name)
      if (versions.length === 0) return send(res, 404, { error: 'not found' })
      const list = versions.map((v) => {
        const bytes = read(name, v)
        return {
          version: v,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.length,
        }
      })
      return send(res, 200, { name, description: describe(name, versions), versions: list })
    }
    if (
      req.method === 'GET' &&
      name !== undefined &&
      version !== undefined &&
      tail === 'package' &&
      parts.length === 5
    ) {
      if (!SEMVER.test(version)) return send(res, 404, { error: 'not found' })
      try {
        return send(res, 200, undefined, read(name, version))
      } catch {
        return send(res, 404, { error: 'not found' })
      }
    }
    if (req.method === 'PUT' && name !== undefined && version !== undefined && tail === undefined) {
      if (!tokenOk(req.headers.authorization, token)) {
        res.setHeader('www-authenticate', 'Bearer')
        return send(res, 401, { error: 'unauthorized' })
      }
      if (!SEMVER.test(version)) return send(res, 400, { error: 'version must be x.y.z' })
      const body = await readBody(req)
      if (body === undefined) return send(res, 400, { error: 'package exceeds 1 MiB' })
      const problem = validatePackage(body.toString('utf8'), name, version)
      if (problem !== undefined) return send(res, 400, { error: problem })
      mkdirSync(join(dir, name), { recursive: true })
      try {
        writeFileSync(join(dir, name, `${version}.json`), body, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          return send(res, 409, { error: 'version exists' })
        throw error
      }
      return send(res, 201, { name, version })
    }
    return send(res, 404, { error: 'not found' })
  }

  return (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'internal error' })
      else res.end()
    })
  }
}
