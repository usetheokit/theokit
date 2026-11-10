import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { dbCommand } from '../../packages/theo/src/cli/commands/db.js'

/**
 * `theokit db migrate` ran `drizzle-kit push`, which diffs the schema straight into the database and
 * never reads the files `theokit db generate` writes, so no `__drizzle_migrations` journal was kept
 * (usetheokit/theokit#1021). `migrate` now applies the generated files; `push` is its own verb.
 */
describe('theokit db runs the drizzle-kit command its verb names', () => {
  let dir: string
  let ran: string[]
  const run = (command: string): void => {
    ran.push(command)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theokit-db-'))
    writeFileSync(join(dir, 'drizzle.config.ts'), 'export default {}\n')
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '.bin', 'drizzle-kit'), '')
    ran = []
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('migrate applies the generated migration files with drizzle-kit migrate', async () => {
    const result = await dbCommand('migrate', dir, run)
    expect(result.status).toBe('success')
    expect(ran).toEqual(['npx drizzle-kit migrate'])
  })

  it('push keeps the schema-diff behaviour under its own name', async () => {
    const result = await dbCommand('push', dir, run)
    expect(result.status).toBe('success')
    expect(ran).toEqual(['npx drizzle-kit push'])
  })

  it('generate still writes migration files', async () => {
    await dbCommand('generate', dir, run)
    expect(ran).toEqual(['npx drizzle-kit generate'])
  })

  it('seed runs the seed file under the configured serverDir', async () => {
    // ESM, as a scaffold is: without it, Node versions that do not strip types natively load the
    // config through tsx as CommonJS and the default export arrives nested.
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
    writeFileSync(join(dir, 'theo.config.ts'), "export default { serverDir: 'src/server' }\n")
    mkdirSync(join(dir, 'src', 'server', 'db'), { recursive: true })
    writeFileSync(join(dir, 'src', 'server', 'db', 'seed.ts'), '')
    const result = await dbCommand('seed', dir, run)
    expect(result.status).toBe('success')
    expect(ran).toEqual(['npx tsx src/server/db/seed.ts'])
  })

  it('seed applies theo.config.ts storage in the child process through a preload (#1439)', async () => {
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
    writeFileSync(
      join(dir, 'theo.config.ts'),
      `export default { serverDir: 'src/server', storage: { servers: { primary: { host: 'localhost', port: 5432, user: 'postgres', password: 'x' } }, databases: { main: { server: 'primary', database: 'app' } } } }\n`,
    )
    mkdirSync(join(dir, 'src', 'server', 'db'), { recursive: true })
    writeFileSync(join(dir, 'src', 'server', 'db', 'seed.ts'), '')
    let preloadBody = ''
    const spy = (command: string): void => {
      ran.push(command)
      const file = command.split(' ')[3] ?? ''
      preloadBody = existsSync(file) ? readFileSync(file, 'utf8') : ''
    }
    const result = await dbCommand('seed', dir, spy)
    expect(result.status).toBe('success')
    expect(ran[0]).toMatch(/^npx tsx --import .*seed-preload\.mjs src\/server\/db\/seed\.ts$/)
    expect(preloadBody).toContain('getStorageManager().configure(')
    expect(preloadBody).toContain('"main"')
  })

  it('lists push among the valid actions when the verb is unknown', async () => {
    const result = await dbCommand('nope', dir, run)
    expect(result.status).toBe('invalid_action')
    expect(result.message).toContain('push')
  })
})
