import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readClaudeCodeSetup } from '../src/migration/claude-code-source.js'
import { copyFixture } from './migration-fixtures.js'

/** Claude Code's project-directory encoding (`session-transcript.ts:52-53` in the SDK). */
function encode(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

const GIT_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'PATH'] as const

/** FR-001, FR-003 (AC-001, AC-002): reading a Claude Code setup. */
describe('readClaudeCodeSetup', () => {
  let dir = ''
  let home = ''
  let project = ''
  const saved: Partial<Record<(typeof GIT_VARIABLES)[number], string | undefined>> = {}

  beforeEach(() => {
    // A git hook or an outer repository must not answer for the temporary project.
    for (const name of GIT_VARIABLES) saved[name] = process.env[name]
    delete process.env.GIT_DIR
    delete process.env.GIT_WORK_TREE
    delete process.env.GIT_INDEX_FILE
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'theoclaw-migration-')))
    copyFixture('claude-code', dir)
    home = join(dir, 'home')
    project = join(dir, 'project')
  })

  afterEach(() => {
    for (const name of GIT_VARIABLES) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    rmSync(dir, { recursive: true, force: true })
  })

  const MEMORY_FILES = ['MEMORY.md', 'ARCH.md', 'notes.md']

  /** Moves the sample's memory to where Claude Code keys the auto memory of `root`. */
  function placeMemory(root: string): void {
    const projects = join(home, '.claude', 'projects', encode(root))
    mkdirSync(projects, { recursive: true })
    renameSync(join(dir, 'memory'), join(projects, 'memory'))
  }

  function gitInit(path: string): void {
    execFileSync('git', ['init', '-q', path])
  }

  it('reads the user and project scopes of a Claude Code setup, the project winning a shared name', () => {
    const setup = readClaudeCodeSetup({ home, project })

    expect(setup.kind).toBe('claude-code')
    expect(setup.instructions.map((file) => file.path)).toEqual(['CLAUDE.md', 'project/CLAUDE.md', 'project/.claude/CLAUDE.md'])
    expect(setup.instructions.map((file) => file.text.trim().split('\n').pop())).toEqual([
      'Fixture user instruction: answer in plain English.',
      'Fixture project instruction: the project is called Lighthouse.',
      'Fixture project-local instruction: prefer short answers.',
    ])
    expect(setup.mcpServers).toEqual({
      // `type: stdio` consumed, so loadMcpJson carries every key that is staged.
      db: { command: 'npx', args: ['-y', 'fixture-db-server'], env: { DB_TOKEN: 'fixture-secret-db-token' } },
      search: { type: 'http', url: 'https://search.example.test/mcp', headers: { Authorization: 'Bearer fixture-secret-search-header' } },
      shared: { command: 'project-shared-server', args: ['--project'] },
    })
    // By name, whichever scope a skill came from.
    expect(setup.skills.map((skill) => [skill.name, skill.description, skill.path])).toEqual([
      ['shared-skill', 'The project-scope copy of the shared skill', 'project/.claude/skills/shared-skill/SKILL.md'],
      ['user-skill', 'A user-scope fixture skill', 'skills/user-skill/SKILL.md'],
    ])
    expect(setup.dropped).toEqual([
      { path: '.claude.json#shared', reason: 'shadowed by the project scope' },
      { path: 'skills/shared-skill/SKILL.md', reason: 'shadowed by the project scope' },
    ])
  })

  it('carries the auto memory of the git root of the project only when a project is given', () => {
    gitInit(project)
    const sub = join(project, 'packages', 'app')
    mkdirSync(sub, { recursive: true })
    placeMemory(project)

    const withProject = readClaudeCodeSetup({ home, project: sub })
    const without = readClaudeCodeSetup({ home })

    // MEMORY.md first, the rest by name; only `*.md` directly under the directory.
    expect(withProject.memories.map((file) => file.path)).toEqual(MEMORY_FILES.map((name) => `projects/${encode(project)}/memory/${name}`))
    expect(withProject.memories[0]?.text).toContain('favourite colour is teal')
    expect(without.memories).toEqual([])
    expect(without.instructions.map((file) => file.path)).toEqual(['CLAUDE.md'])
    expect(Object.keys(without.mcpServers).sort()).toEqual(['db', 'search', 'shared'])
  })

  it('keys the memory by the project itself outside a git repository', () => {
    process.env.GIT_CEILING_DIRECTORIES = dirname(dir)
    placeMemory(project)

    expect(readClaudeCodeSetup({ home, project }).memories).toHaveLength(MEMORY_FILES.length)
  })

  it('keys the memory by the project itself when git is not installed', () => {
    const emptyBin = join(dir, 'empty-bin')
    mkdirSync(emptyBin)
    process.env.PATH = emptyBin
    placeMemory(project)

    expect(readClaudeCodeSetup({ home, project }).memories).toHaveLength(MEMORY_FILES.length)
  })

  it('a relative project path keys the same memory directory as its absolute form (EC-3)', () => {
    gitInit(project)
    const sub = join(project, 'sub')
    mkdirSync(sub)
    placeMemory(project)

    const fromRelative = readClaudeCodeSetup({ home, project: relative(process.cwd(), sub) }).memories

    expect(fromRelative).toHaveLength(MEMORY_FILES.length)
    expect(fromRelative).toEqual(readClaudeCodeSetup({ home, project: sub }).memories)
  })

  it('lets only a carried project entry shadow a user one', () => {
    writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { db: { args: ['no transport'] } } }))
    mkdirSync(join(project, '.claude', 'skills', 'user-skill'), { recursive: true })
    writeFileSync(join(project, '.claude', 'skills', 'user-skill', 'SKILL.md'), '---\nname: user-skill\n---\nNo description.\n')

    const setup = readClaudeCodeSetup({ home, project })

    expect(setup.mcpServers.db).toEqual({ command: 'npx', args: ['-y', 'fixture-db-server'], env: { DB_TOKEN: 'fixture-secret-db-token' } })
    expect(setup.skills.find((skill) => skill.name === 'user-skill')?.path).toBe('skills/user-skill/SKILL.md')
    expect(setup.dropped).toContainEqual({ path: 'project/.mcp.json#db', reason: 'neither command nor url' })
    expect(setup.dropped).toContainEqual({ path: 'project/.claude/skills/user-skill/SKILL.md', reason: 'frontmatter lacks name or description' })
  })

  it('skips a missing instruction file and keeps the order of the others', () => {
    rmSync(join(project, 'CLAUDE.md'))

    expect(readClaudeCodeSetup({ home, project }).instructions.map((file) => file.path)).toEqual(['CLAUDE.md', 'project/.claude/CLAUDE.md'])
  })

  it('drops an mcpServers that is not an object and reads a config file with none as nothing', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: ['db'] }))
    writeFileSync(join(project, '.mcp.json'), JSON.stringify({ numStartups: 1 }))

    const setup = readClaudeCodeSetup({ home, project })

    expect(setup.mcpServers).toEqual({})
    expect(setup.dropped).toEqual([
      { path: '.claude.json', reason: 'mcpServers is not an object' },
      { path: 'skills/shared-skill/SKILL.md', reason: 'shadowed by the project scope' },
    ])
  })

  it('drops a config file whose top level is not a JSON object', () => {
    writeFileSync(join(project, '.mcp.json'), '[]')

    expect(readClaudeCodeSetup({ home, project }).dropped).toContainEqual({ path: 'project/.mcp.json', reason: 'not a JSON object' })
  })

  it('reads no memory for a project with no memory directory, and orders one without MEMORY.md by name', () => {
    expect(readClaudeCodeSetup({ home, project }).memories).toEqual([])

    rmSync(join(dir, 'memory', 'MEMORY.md'))
    placeMemory(project)

    expect(readClaudeCodeSetup({ home, project }).memories.map((file) => file.path.split('/').pop())).toEqual(['ARCH.md', 'notes.md'])
  })

  it('lists an instruction or memory file over 262144 bytes as dropped', () => {
    writeFileSync(join(project, 'CLAUDE.md'), 'x'.repeat(262_145))
    writeFileSync(join(dir, 'memory', 'notes.md'), 'x'.repeat(262_145))
    placeMemory(project)

    const setup = readClaudeCodeSetup({ home, project })

    expect(setup.dropped).toContainEqual({ path: 'project/CLAUDE.md', reason: 'file over 262144 bytes' })
    expect(setup.dropped).toContainEqual({ path: `projects/${encode(project)}/memory/notes.md`, reason: 'file over 262144 bytes' })
    expect(setup.memories.map((file) => file.path.split('/').pop())).toEqual(['MEMORY.md', 'ARCH.md'])
  })

  it('keys the memory by the project, not by a repository GIT_DIR points at', () => {
    const other = join(dir, 'other-repo')
    gitInit(other)
    process.env.GIT_DIR = join(other, '.git')
    process.env.GIT_CEILING_DIRECTORIES = dirname(dir)
    placeMemory(project)

    expect(readClaudeCodeSetup({ home, project }).memories).toHaveLength(MEMORY_FILES.length)
  })

  it('lists a 300 KB .claude.json as dropped over 262144 bytes and still reads the project .mcp.json (EC-2, D4)', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: {}, padding: 'x'.repeat(300_000) }))

    const setup = readClaudeCodeSetup({ home, project })

    expect(setup.dropped).toContainEqual({ path: '.claude.json', reason: 'file over 262144 bytes' })
    expect(Object.keys(setup.mcpServers)).toEqual(['shared'])
  })

  it('lists a config file that is not valid JSON as dropped and keeps reading', () => {
    writeFileSync(join(project, '.mcp.json'), '{ not json')

    const setup = readClaudeCodeSetup({ home, project })

    expect(setup.dropped).toContainEqual({ path: 'project/.mcp.json', reason: 'not valid JSON' })
    expect(Object.keys(setup.mcpServers).sort()).toEqual(['db', 'search', 'shared'])
  })

  it('lists an uncarried key and a bad entry of a config file, by server name and never by value', () => {
    writeFileSync(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { slow: { command: 'x', timeout: 5 }, broken: { command: 'x', env: { K: { v: 'hidden-value' } } } } }),
    )

    const setup = readClaudeCodeSetup({ home, project })

    expect(setup.dropped).toContainEqual({ path: 'project/.mcp.json#slow.timeout', reason: 'field not carried' })
    expect(setup.dropped).toContainEqual({ path: 'project/.mcp.json#broken', reason: 'env value is not a string, number or boolean' })
    expect(JSON.stringify(setup.dropped)).not.toContain('hidden-value')
    expect(setup.mcpServers.slow).toEqual({ command: 'x' })
  })

  it('reads a configDir given apart from the home', () => {
    const configDir = join(dir, 'elsewhere')
    renameSync(join(home, '.claude'), configDir)

    const setup = readClaudeCodeSetup({ configDir, home })

    expect(setup.source).toBe(configDir)
    // The user-scope servers stay those of `<home>/.claude.json` (FR-001), whatever the configDir.
    expect(Object.keys(setup.mcpServers).sort()).toEqual(['db', 'search', 'shared'])
    expect(setup.skills.map((skill) => skill.name)).toEqual(['shared-skill', 'user-skill'])
  })
})
