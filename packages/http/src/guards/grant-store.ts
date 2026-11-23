import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { GuardConfigError } from './errors.js'

/** A stored grant: the credential is never kept, only its SHA-256 hash. */
export interface Grant {
  readonly id: string
  readonly name: string
  readonly scopes: readonly string[]
  readonly createdAt: string
  readonly revokedAt?: string
}

export interface GrantStore {
  /** Makes a grant and returns it with the credential, which is shown once and not stored. */
  create(
    name: string,
    scopes: readonly string[],
  ): Promise<{ readonly grant: Grant; readonly credential: string }>
  /** Revokes the active grant with this name. Resolves false when there is none. */
  revoke(name: string): Promise<boolean>
  /** The active grant this credential belongs to, or `undefined`. Re-reads the file each call. */
  authenticate(credential: string): Promise<Grant | undefined>
  /** Every grant, revoked ones included. */
  list(): Promise<readonly Grant[]>
}

interface StoredGrant extends Grant {
  readonly hash: string
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const tails = new Map<string, Promise<unknown>>()

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(task)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  tails.set(key, tail)
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })
  return run
}

function strip({ hash: _hash, ...grant }: StoredGrant): Grant {
  return grant
}

/**
 * A file-backed store of scoped, revocable credentials. Only SHA-256 hashes reach the disk (file
 * mode 0600, replaced atomically). A missing file is an empty store; a malformed one throws, so
 * authentication fails closed. Revocation holds across store instances on the same file.
 */
export function createGrantStore(file: string): GrantStore {
  const path = resolve(file)

  async function read(): Promise<StoredGrant[]> {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const parsed = JSON.parse(text) as { grants?: unknown }
    if (!Array.isArray(parsed.grants)) {
      throw new GuardConfigError(`grant file ${path} is malformed`, path)
    }
    return parsed.grants as StoredGrant[]
  }

  async function write(grants: readonly StoredGrant[]): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(temp, JSON.stringify({ grants }), { mode: 0o600 })
    await rename(temp, path)
  }

  return {
    create: (name, scopes) => {
      if (!NAME.test(name)) {
        throw new GuardConfigError(
          `invalid grant name "${name}": use letters, digits, - and _`,
          name,
        )
      }
      const credential = randomBytes(32).toString('base64url')
      const stored: StoredGrant = {
        id: `g_${randomBytes(6).toString('hex')}`,
        name,
        scopes: [...new Set(scopes)],
        createdAt: new Date().toISOString(),
        hash: sha256(credential),
      }
      return serialized(path, async () => {
        const grants = await read()
        if (grants.some((g) => g.name === name && g.revokedAt === undefined)) {
          throw new GuardConfigError(`an active grant named "${name}" exists`, name)
        }
        await write([...grants, stored])
        return { grant: strip(stored), credential }
      })
    },
    revoke: (name) =>
      serialized(path, async () => {
        const grants = await read()
        const index = grants.findIndex((g) => g.name === name && g.revokedAt === undefined)
        if (index < 0) return false
        const found = grants[index]
        grants[index] = { ...found, revokedAt: new Date().toISOString() }
        await write(grants)
        return true
      }),
    authenticate: async (credential) => {
      const given = Buffer.from(sha256(credential), 'hex')
      let match: StoredGrant | undefined
      for (const g of await read()) {
        const stored = Buffer.from(g.hash, 'hex')
        if (
          stored.length === given.length &&
          timingSafeEqual(stored, given) &&
          g.revokedAt === undefined
        ) {
          match = g
        }
      }
      return match === undefined ? undefined : strip(match)
    },
    list: async () => (await read()).map(strip),
  }
}
