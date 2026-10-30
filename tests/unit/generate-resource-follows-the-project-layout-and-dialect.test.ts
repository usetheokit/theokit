import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { generate, generateCommand } from '../../packages/theo/src/cli/commands/generate.js'

/**
 * `theokit generate resource` assumed `server/` and SQLite (usetheokit/theokit#1022). In the
 * scaffold (`serverDir: 'src/server'`) it refused with "Not a Theo project" although
 * `theo.config.ts` was there; in a Postgres project it appended `sqliteTable(...)` with no import
 * and wrote handlers calling `.all()`/`.get()`, which the Postgres drivers do not have.
 */
const dirs: string[] = []

function project(opts: { serverDir?: string; schema?: string; drizzleDialect?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'theo-gen-resource-'))
  dirs.push(dir)
  const serverDir = opts.serverDir ?? 'server'
  writeFileSync(
    join(dir, 'theo.config.ts'),
    opts.serverDir === undefined
      ? 'export default {}\n'
      : `export default { serverDir: '${opts.serverDir}' }\n`,
  )
  if (opts.schema !== undefined) {
    mkdirSync(join(dir, serverDir, 'db'), { recursive: true })
    writeFileSync(join(dir, serverDir, 'db', 'schema.ts'), opts.schema)
  }
  if (opts.drizzleDialect !== undefined) {
    writeFileSync(
      join(dir, 'drizzle.config.ts'),
      `export default { dialect: '${opts.drizzleDialect}', schema: './x' }\n`,
    )
  }
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('generate resource follows the project layout and dialect', () => {
  it('writes under the configured serverDir', async () => {
    const dir = project({ serverDir: 'src/server', schema: '' })
    const result = await generate({
      cwd: dir,
      type: 'resource',
      name: 'posts',
      fields: ['title:string'],
    })
    expect(result.status).toBe('created')
    expect(readFileSync(join(dir, 'src/server/routes/posts/index.ts'), 'utf-8')).toContain(
      'src/server/routes/posts/index.ts',
    )
    expect(readFileSync(join(dir, 'src/server/db/schema.ts'), 'utf-8')).toContain(
      'export const posts =',
    )
    expect(readFileSync(join(dir, 'tests/posts.test.ts'), 'utf-8')).toContain(
      '../src/server/db/schema.js',
    )
  })

  it('reports the missing schema file, not a missing theo.config.ts', async () => {
    const dir = project({ serverDir: 'src/server' })
    const orig = process.cwd()
    process.chdir(dir)
    try {
      await expect(generateCommand('resource', 'posts', ['title:string'])).rejects.toThrow(
        /src\/server\/db\/schema\.ts not found/,
      )
    } finally {
      process.chdir(orig)
    }
  })

  it('emits pgTable with imports and awaited queries for a Postgres schema', async () => {
    const dir = project({ schema: "import { pgTable } from 'drizzle-orm/pg-core'\n" })
    await generate({
      cwd: dir,
      type: 'resource',
      name: 'posts',
      fields: ['title:string', 'published:boolean'],
    })
    const schema = readFileSync(join(dir, 'server/db/schema.ts'), 'utf-8')
    expect(schema).toContain(
      "import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'",
    )
    expect(schema).toContain("export const posts = pgTable('posts', {")
    expect(schema).toContain("published: boolean('published').notNull().default(false)")
    expect(schema).not.toContain('sqliteTable')

    const routes =
      readFileSync(join(dir, 'server/routes/posts/index.ts'), 'utf-8') +
      readFileSync(join(dir, 'server/routes/posts/[id].ts'), 'utf-8')
    expect(routes).not.toMatch(/\.(all|get|run)\(\)/)
    expect(routes).toContain('await db.select().from(posts)')
  })

  it('takes the dialect from drizzle.config.ts when the schema imports nothing yet', async () => {
    const dir = project({ schema: '', drizzleDialect: 'postgresql' })
    await generate({ cwd: dir, type: 'resource', name: 'posts', fields: ['title:string'] })
    expect(readFileSync(join(dir, 'server/db/schema.ts'), 'utf-8')).toContain("pgTable('posts'")
  })

  it('imports the SQLite builders it uses, merged into an existing import', async () => {
    const dir = project({ schema: "import { text } from 'drizzle-orm/sqlite-core'\n" })
    await generate({ cwd: dir, type: 'resource', name: 'posts', fields: ['title:string'] })
    const schema = readFileSync(join(dir, 'server/db/schema.ts'), 'utf-8')
    expect(schema).toContain("import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'")
    expect(schema.match(/from 'drizzle-orm\/sqlite-core'/g)).toHaveLength(1)
  })

  it('refuses a dialect it cannot write code for, and writes nothing', async () => {
    const dir = project({ schema: '', drizzleDialect: 'mysql' })
    const result = await generate({
      cwd: dir,
      type: 'resource',
      name: 'posts',
      fields: ['title:string'],
    })
    expect(result.status).toBe('invalid_config')
    expect(result.message).toContain('"mysql"')
    expect(readFileSync(join(dir, 'server/db/schema.ts'), 'utf-8')).toBe('')
  })
})
