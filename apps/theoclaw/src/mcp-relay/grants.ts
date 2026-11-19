import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { replaceFileAtomic } from '@theokit/sdk/persistence'

import { BUILT_TOOL_NAMES, CONTROL_TOOL_NAMES } from '../tools/tool-names.js'

/** The tools a grant gets when none are named: read-only ones only. */
export const DEFAULT_GRANT_TOOLS: readonly string[] = ['list_dir', 'read_file']

export interface Grant {
  readonly id: string
  readonly name: string
  readonly tokenHash: string
  readonly tools: readonly string[]
  readonly createdAt: string
  readonly revokedAt?: string
}

export class GrantError extends Error {}

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function grantsPath(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): string {
  const explicit = env.THEOCLAW_STATE_DIR?.trim()
  const state =
    explicit || join(env.XDG_STATE_HOME?.trim() || join(homeDir, '.local', 'state'), 'theoclaw')
  return join(state, 'mcp-relay-grants.json')
}

export class GrantStore {
  private grants: Grant[] = []

  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  /** Reads the file; a missing file is an empty store. */
  load(): this {
    if (!existsSync(this.path)) return this
    const saved = JSON.parse(readFileSync(this.path, 'utf8')) as { grants?: Grant[] }
    this.grants = saved.grants ?? []
    return this
  }

  list(): readonly Grant[] {
    return this.grants
  }

  /** Makes a grant and returns it with the plaintext token, which is not stored. */
  async create(
    name: string,
    tools?: readonly string[],
  ): Promise<{ readonly grant: Grant; readonly token: string }> {
    if (!NAME.test(name))
      throw new GrantError(`invalid name "${name}": use letters, digits, - and _`)
    if (this.grants.some((g) => g.name === name && g.revokedAt === undefined)) {
      throw new GrantError(`an active grant named "${name}" exists`)
    }
    const chosen = tools ?? DEFAULT_GRANT_TOOLS
    const known = new Set([...BUILT_TOOL_NAMES, ...CONTROL_TOOL_NAMES])
    const unknown = chosen.filter((t) => !known.has(t))
    if (chosen.length === 0 || unknown.length > 0) {
      throw new GrantError(
        unknown.length > 0 ? `unknown tool: ${unknown.join(', ')}` : 'no tools named',
      )
    }
    const token = randomBytes(32).toString('base64url')
    const grant: Grant = {
      id: `g_${randomBytes(6).toString('hex')}`,
      name,
      tokenHash: hashToken(token),
      tools: [...new Set(chosen)],
      createdAt: new Date().toISOString(),
    }
    this.grants.push(grant)
    await this.persist()
    return { grant, token }
  }

  /** Revokes the active grant with this name or id. */
  async revoke(nameOrId: string): Promise<Grant> {
    const index = this.grants.findIndex(
      (g) => g.revokedAt === undefined && (g.name === nameOrId || g.id === nameOrId),
    )
    const found = this.grants[index]
    if (found === undefined) throw new GrantError(`no active grant "${nameOrId}"`)
    const revoked: Grant = { ...found, revokedAt: new Date().toISOString() }
    this.grants[index] = revoked
    await this.persist()
    return revoked
  }

  /** The active grant this token belongs to, or undefined. */
  authenticate(token: string): Grant | undefined {
    const given = Buffer.from(hashToken(token), 'hex')
    let match: Grant | undefined
    for (const g of this.grants) {
      const stored = Buffer.from(g.tokenHash, 'hex')
      if (
        stored.length === given.length &&
        timingSafeEqual(stored, given) &&
        g.revokedAt === undefined
      )
        match = g
    }
    return match
  }

  /** Snapshots now and writes in call order, so a slow earlier write never lands over a later one. */
  private persist(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true })
    const text = JSON.stringify({ grants: this.grants })
    const run = this.writes.then(() => replaceFileAtomic(this.path, text, { mode: 0o600 }))
    this.writes = run.catch(() => undefined)
    return run
  }
}
