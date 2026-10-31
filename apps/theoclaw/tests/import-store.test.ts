import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { readClaudeCodeSetup } from '../src/migration/claude-code-source.js'
import type { ForeignSetup } from '../src/migration/foreign-setup.js'
import { readHermesSetup } from '../src/migration/hermes-source.js'
import { readImport, writeImport } from '../src/migration/import-store.js'
import { copyFixture } from './migration-fixtures.js'

const now = new Date('2026-10-31T12:00:00Z')

function setupWith(overrides: Partial<ForeignSetup>): ForeignSetup {
  return {
    kind: 'claude-code',
    source: '/nowhere',
    instructions: [{ path: 'CLAUDE.md', text: 'Follow the house style.' }],
    mcpServers: { good: { command: 'npx', args: ['good-server'] } },
    skills: [{ name: 'greet', description: 'Greets', body: 'Say hello.\n', path: 'skills/greet/SKILL.md' }],
    memories: [{ path: 'MEMORY.md', text: 'The owner likes tea.' }],
    dropped: [],
    ...overrides,
  }
}

/** Every entry under `dir` with its mode, the directory itself included. */
function modes(dir: string): Array<[string, number, boolean]> {
  const out: Array<[string, number, boolean]> = []
  const walk = (path: string): void => {
    const stat = statSync(path)
    out.push([path, stat.mode & 0o777, stat.isDirectory()])
    if (stat.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name))
  }
  walk(dir)
  return out
}

/** Every file under `dir` with its bytes, for a byte-identical comparison. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, , isDirectory] of modes(dir)) if (!isDirectory) out[path] = readFileSync(path, 'base64')
  return out
}

function refusal(run: () => unknown): TheoClawConfigError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error('the import was not refused')
}

/** FR-004, FR-005, NFR-001, NFR-002, NFR-004: staging, validating and reading back an import. */
describe('the import store', () => {
  let dir = ''
  let stateDir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theoclaw-migration-'))
    stateDir = join(dir, 'state')
  })

  afterEach(() => {
    delete process.env.THEOCLAW_MIGRATION_UNSET_FOR_TEST
    rmSync(dir, { recursive: true, force: true })
  })

  function leftovers(): string[] {
    return readdirSync(stateDir).filter((name) => name !== 'import')
  }

  it('writes the import with directories at 0700 and files at 0600 on a fresh and a previous import', () => {
    writeImport(stateDir, setupWith({}), { now })
    // A widened previous import is replaced, never reused.
    chmodSync(join(stateDir, 'import'), 0o755)
    writeImport(stateDir, setupWith({ instructions: [{ path: 'CLAUDE.md', text: 'Second.' }] }), { now })

    const wrong = modes(join(stateDir, 'import')).filter(([, mode, isDirectory]) => mode !== (isDirectory ? 0o700 : 0o600))
    expect(wrong).toEqual([])
    expect(readFileSync(join(stateDir, 'import', 'instructions.md'), 'utf8')).toBe('Second.')
    expect(leftovers()).toEqual([])
  })

  it('a server loadMcpJson ignores refuses the import and leaves the previous one byte-identical', () => {
    writeImport(stateDir, setupWith({}), { now })
    const before = snapshot(join(stateDir, 'import'))
    // Built here, bypassing the readers, so only the warning collector can refuse it (AC-007).
    const bad = setupWith({ mcpServers: { bad: { command: 'x', env: { K: { nested: 1 } } } } as unknown as ForeignSetup['mcpServers'] })

    const error = refusal(() => writeImport(stateDir, bad, { now }))

    expect(error.message).toContain('"bad"')
    expect(snapshot(join(stateDir, 'import'))).toEqual(before)
    expect(leftovers()).toEqual([])
  })

  it('a field loadMcpJson does not carry refuses the import', () => {
    const extra = setupWith({ mcpServers: { slow: { command: 'x', timeout: 5 } } as unknown as ForeignSetup['mcpServers'] })

    expect(refusal(() => writeImport(stateDir, extra, { now })).message).toContain('"slow"')
    expect(existsSync(join(stateDir, 'import'))).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('a url entry with an unknown transport type refuses the import naming the server (D5)', () => {
    const socket = setupWith({ mcpServers: { socket: { type: 'websocket', url: 'https://h/mcp' } } })

    expect(refusal(() => writeImport(stateDir, socket, { now })).message).toContain('"socket"')
  })

  it('never puts an MCP value in a refusal', () => {
    const bad = setupWith({ mcpServers: { bad: { command: 'x', env: { K: { secret: 'sk-hidden-value' } } } } as unknown as ForeignSetup['mcpServers'] })

    expect(refusal(() => writeImport(stateDir, bad, { now })).message).not.toContain('sk-hidden-value')
  })

  it('an unset variable reference is a note and keeps the server', () => {
    const referencing = setupWith({ mcpServers: { db: { command: 'x', env: { TOKEN: '${THEOCLAW_MIGRATION_UNSET_FOR_TEST}', KEY: 'sk-note-sentinel' } } } })

    const { notes } = writeImport(stateDir, referencing, { now })

    // Filtered by server: a malformed managed policy on the machine adds a note of its own.
    const aboutDb = notes.filter((note) => note.includes('"db"'))
    expect(aboutDb).toHaveLength(1)
    expect(aboutDb[0]).toContain('THEOCLAW_MIGRATION_UNSET_FOR_TEST')
    expect(notes.join('\n')).not.toContain('sk-note-sentinel')
    expect(readImport(stateDir)?.mcpServers).toHaveProperty('db')
  })

  it('reads an import back as instructions, memory, MCP servers and inline skills', () => {
    writeImport(
      stateDir,
      setupWith({
        instructions: [
          { path: 'CLAUDE.md', text: 'First instruction.' },
          { path: 'project/CLAUDE.md', text: 'Second instruction.' },
        ],
        mcpServers: { good: { command: 'npx', args: ['good-server'] }, web: { type: 'http', url: 'https://h/mcp', headers: { A: 'b' } } },
        skills: [{ name: 'greet', description: 'Greets: politely', body: 'Say hello.\n', path: 'skills/greet/SKILL.md' }],
      }),
      { now },
    )

    const imported = readImport(stateDir)

    expect(imported?.kind).toBe('claude-code')
    expect(imported?.instructions).toBe('First instruction.\n\nSecond instruction.')
    expect(imported?.memory).toBe('The owner likes tea.')
    expect(imported?.mcpServers).toEqual({ good: { command: 'npx', args: ['good-server'] }, web: { type: 'http', url: 'https://h/mcp', headers: { A: 'b' } } })
    expect(imported?.skills.map((skill) => [skill.name, skill.description, skill.instructions])).toEqual([['greet', 'Greets: politely', 'Say hello.\n']])
    expect(imported?.counts).toEqual({ instructions: 2, memories: 1, skills: 1, mcpServers: 2 })
  })

  it('an unparsable manifest stops with an error naming its path; no import reads as undefined', () => {
    expect(readImport(stateDir)).toBeUndefined()
    writeImport(stateDir, setupWith({}), { now })
    const manifest = join(stateDir, 'import', 'manifest.json')
    writeFileSync(manifest, '{')

    const error = refusal(() => readImport(stateDir))

    expect(error.message).toContain(manifest)
    expect(error.variable).toBe('THEOCLAW_STATE_DIR')
  })

  it('a staged file the manifest names that is missing stops with an error naming it', () => {
    writeImport(stateDir, setupWith({}), { now })
    const skill = join(stateDir, 'import', 'skills', 'greet', 'SKILL.md')
    rmSync(skill)

    expect(refusal(() => readImport(stateDir)).message).toContain(skill)
  })

  it('imports both fixtures in under 2000 ms', () => {
    const claude = copyFixture('claude-code', join(dir, 'claude'))
    const hermes = copyFixture('hermes', join(dir, 'hermes'))
    const started = performance.now()

    writeImport(join(dir, 'state-claude'), readClaudeCodeSetup({ home: join(claude, 'home'), project: join(claude, 'project') }), { now })
    writeImport(join(dir, 'state-hermes'), readHermesSetup({ root: hermes }), { now })

    expect(performance.now() - started).toBeLessThan(2000)
    expect(readImport(join(dir, 'state-hermes'))?.counts).toEqual({ instructions: 2, memories: 2, skills: 1, mcpServers: 2 })
  })

  it('restores a lone import.previous-* when import is absent, in writeImport and readImport (EC-4)', () => {
    writeImport(stateDir, setupWith({}), { now })
    renameSync(join(stateDir, 'import'), join(stateDir, 'import.previous-999'))

    expect(readImport(stateDir)?.instructions).toBe('Follow the house style.')
    expect(readdirSync(stateDir)).toEqual(['import'])

    renameSync(join(stateDir, 'import'), join(stateDir, 'import.previous-999'))
    mkdirSync(join(stateDir, 'import.staging-1-1'))
    const bad = setupWith({ mcpServers: { bad: { command: 'x', env: { K: [] } } } as unknown as ForeignSetup['mcpServers'] })
    refusal(() => writeImport(stateDir, bad, { now }))

    // The interrupted swap is undone before the refused stage, and the stale staging is gone.
    expect(readdirSync(stateDir)).toEqual(['import'])
    expect(readImport(stateDir)?.instructions).toBe('Follow the house style.')
  })

  it('writes an import into a state directory it creates at 0700 (EC-5)', () => {
    const nested = join(dir, 'a', 'b', 'state')

    writeImport(nested, setupWith({}), { now })

    expect(statSync(nested).mode & 0o777).toBe(0o700)
  })

  it('refuses a state directory it cannot create, naming THEOCLAW_STATE_DIR', () => {
    writeFileSync(join(dir, 'file'), '')

    const error = refusal(() => writeImport(join(dir, 'file', 'state'), setupWith({}), { now }))

    expect(error.variable).toBe('THEOCLAW_STATE_DIR')
    expect(error.message).toContain('ENOTDIR')
  })

  it('stages an empty mcpServers map so a setup with no server reads back (EC-6)', () => {
    writeImport(stateDir, setupWith({ mcpServers: {}, skills: [] }), { now })

    expect(JSON.parse(readFileSync(join(stateDir, 'import', '.mcp.json'), 'utf8'))).toEqual({ mcpServers: {} })
    expect(readImport(stateDir)?.mcpServers).toEqual({})
  })

  it('removes a stale import.previous-* beside a present import before staging (EC-4)', () => {
    writeImport(stateDir, setupWith({}), { now })
    mkdirSync(join(stateDir, 'import.previous-999'))

    writeImport(stateDir, setupWith({ instructions: [{ path: 'CLAUDE.md', text: 'Second.' }] }), { now })

    expect(readdirSync(stateDir)).toEqual(['import'])
    expect(readImport(stateDir)?.instructions).toBe('Second.')
  })

  it('a manifest whose skills differ from the staged skill directories stops naming the manifest', () => {
    writeImport(stateDir, setupWith({}), { now })
    const manifest = join(stateDir, 'import', 'manifest.json')
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
    mkdirSync(join(stateDir, 'import', 'skills', 'extra'))
    writeFileSync(join(stateDir, 'import', 'skills', 'extra', 'SKILL.md'), '---\nname: extra\ndescription: Extra\n---\nbody\n')
    writeFileSync(manifest, JSON.stringify(parsed))

    expect(refusal(() => readImport(stateDir)).message).toContain(manifest)
  })

  it('a manifest naming an unknown kind stops naming the manifest', () => {
    writeImport(stateDir, setupWith({}), { now })
    const manifest = join(stateDir, 'import', 'manifest.json')
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
    writeFileSync(manifest, JSON.stringify({ ...parsed, kind: 'openclaw' }))

    expect(refusal(() => readImport(stateDir)).message).toContain(manifest)
  })

  it('a corrupt staged .mcp.json stops naming the file and no value from it', () => {
    writeImport(stateDir, setupWith({}), { now })
    const mcp = join(stateDir, 'import', '.mcp.json')
    writeFileSync(mcp, '{"mcpServers": {"db": {"command": "x", "env": {"K": "sk-corrupt-sentinel" oops')

    const error = refusal(() => readImport(stateDir))

    expect(error.message).toContain(mcp)
    expect(error.message).not.toContain('sk-corrupt-sentinel')
    expect(error.variable).toBe('THEOCLAW_STATE_DIR')
  })

  it('a manifest naming an unsafe skill name stops naming the manifest', () => {
    writeImport(stateDir, setupWith({}), { now })
    const manifest = join(stateDir, 'import', 'manifest.json')
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
    writeFileSync(manifest, JSON.stringify({ ...parsed, skills: ['../escape'] }))

    expect(refusal(() => readImport(stateDir)).message).toContain(manifest)
  })

  it('refuses a skill that would not read back once staged, leaving no import', () => {
    // A body under the cap whose staged file, frontmatter included, goes over it.
    const body = 'x'.repeat(262_144 - 40)
    const big = setupWith({ skills: [{ name: 'big', description: 'A long skill description', body, path: 'skills/big/SKILL.md' }] })

    expect(refusal(() => writeImport(stateDir, big, { now })).message).toContain('"big"')
    expect(existsSync(join(stateDir, 'import'))).toBe(false)
    expect(leftovers()).toEqual([])
  })
})
