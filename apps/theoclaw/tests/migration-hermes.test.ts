import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type DroppedEntry, readSkillsDir } from '../src/migration/foreign-setup.js'
import { readHermesSetup } from '../src/migration/hermes-source.js'
import { normaliseMcpEntry } from '../src/migration/mcp-entry.js'
import { copyFixture, FIXTURE_SECRETS } from './migration-fixtures.js'

/** FR-003: the normalisation both readers share (plan T1.1). */
describe('normaliseMcpEntry', () => {
  it('normalises a stdio entry with type stdio and numeric env values to the carried shape', () => {
    const result = normaliseMcpEntry({ type: 'stdio', command: 'npx', args: ['x'], env: { PORT: 8080, DEBUG: true }, cwd: '/w' })

    expect(result).toEqual({ entry: { command: 'npx', args: ['x'], env: { PORT: '8080', DEBUG: 'true' }, cwd: '/w' }, notCarried: [] })
  })

  it('drops an entry with neither or both transports, with non-string args, with an object env value, with an ftp url', () => {
    expect(normaliseMcpEntry({ args: [] }).reason).toBe('neither command nor url')
    expect(normaliseMcpEntry({ command: 'x', url: 'https://h' }).reason).toBe('both command and url')
    expect(normaliseMcpEntry({ command: 'x', args: ['ok', 1] }).reason).toBe('args is not an array of strings')
    expect(normaliseMcpEntry({ command: 'x', env: { K: { nested: 1 } } }).reason).toBe(
      'env value is not a string, number or boolean',
    )
    expect(normaliseMcpEntry({ url: 'https://h', headers: { A: null } }).reason).toBe(
      'headers value is not a string, number or boolean',
    )
    expect(normaliseMcpEntry({ url: 'ftp://h/x' }).reason).toBe('url is not http: or https:')
    expect(normaliseMcpEntry({ url: 'not a url' }).reason).toBe('url is not http: or https:')
    expect(normaliseMcpEntry('npx').reason).toBe('not an object')
    expect(normaliseMcpEntry({ url: 'ftp://h/x' }).entry).toBeUndefined()
    // loadMcpJson refuses an empty command or url (`mcp-file.ts:305`), so neither counts as present.
    expect(normaliseMcpEntry({ command: '' }).reason).toBe('neither command nor url')
    expect(normaliseMcpEntry({ url: '' }).reason).toBe('neither command nor url')
  })

  it('drops an entry whose args is not an array, whose env is an array, or that is itself an array', () => {
    expect(normaliseMcpEntry({ command: 'x', args: 'x' }).reason).toBe('args is not an array of strings')
    expect(normaliseMcpEntry({ command: 'x', env: ['A=1'] }).reason).toBe('env value is not a string, number or boolean')
    expect(normaliseMcpEntry([]).reason).toBe('not an object')
  })

  it('keeps an empty env, and stages a url entry typed stdio as written for the import to refuse (D5)', () => {
    expect(normaliseMcpEntry({ command: 'x', env: {} }).entry).toEqual({ command: 'x', env: {} })
    expect(normaliseMcpEntry({ type: 'stdio', url: 'https://h' }).entry).toEqual({ type: 'stdio', url: 'https://h' })
  })

  it('keeps an env key named __proto__ as an own key', () => {
    const entry = normaliseMcpEntry(JSON.parse('{"command":"x","env":{"__proto__":"v"}}')).entry as { env: Record<string, string> }

    expect(Object.keys(entry.env)).toEqual(['__proto__'])
  })

  it('lists a non-string cwd as not carried and leaves it out of the entry', () => {
    expect(normaliseMcpEntry({ command: 'npx', cwd: 5 })).toEqual({ entry: { command: 'npx' }, notCarried: ['cwd'] })
  })

  it('never puts a value in a drop reason', () => {
    const reason = normaliseMcpEntry({ command: 'x', env: { TOKEN: { secret: 'sk-live-123' } } }).reason ?? ''

    expect(reason).not.toContain('sk-live-123')
  })

  it('lists an uncarried key as not carried without dropping the entry', () => {
    const result = normaliseMcpEntry({ command: 'npx', timeout: 5, disabled: false })

    expect(result.entry).toEqual({ command: 'npx' })
    expect(result.notCarried).toEqual(['timeout', 'disabled'])
  })

  it('stages a url entry typed streamable-http as http, and lists type on a command entry typed http as not carried (D5)', () => {
    expect(normaliseMcpEntry({ type: 'streamable-http', url: 'https://h/mcp' }).entry).toEqual({ type: 'http', url: 'https://h/mcp' })
    expect(normaliseMcpEntry({ url: 'https://h/mcp', headers: { 'X-N': 2 } }).entry).toEqual({
      type: 'http',
      url: 'https://h/mcp',
      headers: { 'X-N': '2' },
    })
    expect(normaliseMcpEntry({ type: 'sse', url: 'http://h/sse' }).entry).toEqual({ type: 'sse', url: 'http://h/sse' })
    // An unknown transport is staged as written, for FR-004's validation to refuse (D5).
    expect(normaliseMcpEntry({ type: 'websocket', url: 'https://h' }).entry).toEqual({ type: 'websocket', url: 'https://h' })
    const command = normaliseMcpEntry({ type: 'http', command: 'npx' })
    expect(command.entry).toEqual({ command: 'npx' })
    expect(command.notCarried).toEqual(['type'])
  })
})

/** FR-003, EC-1, EC-7, EC-9: the `SKILL.md` directory read both readers share. */
describe('readSkillsDir', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theoclaw-migration-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function skill(directory: string, frontmatter: string, body = 'Body.\n'): void {
    mkdirSync(join(dir, directory), { recursive: true })
    writeFileSync(join(dir, directory, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`)
  }

  it('reads name, description and body of each SKILL.md', () => {
    skill('one', 'name: one\ndescription: The first skill', 'Say ONE.\n')
    const dropped: DroppedEntry[] = []

    expect(readSkillsDir(dir, 'skills', dropped)).toEqual([
      { name: 'one', description: 'The first skill', body: 'Say ONE.\n', path: 'skills/one/SKILL.md' },
    ])
    expect(dropped).toEqual([])
  })

  it('drops a skill named ../../evil as not a safe directory name (EC-1)', () => {
    skill('evil', 'name: ../../evil\ndescription: escapes')
    skill('safe-skill', 'name: safe-skill\ndescription: stays')
    const dropped: DroppedEntry[] = []

    expect(readSkillsDir(dir, 'skills', dropped).map((s) => s.name)).toEqual(['safe-skill'])
    expect(dropped).toEqual([{ path: 'skills/evil/SKILL.md', reason: 'skill name is not a safe directory name' }])
  })

  it('keeps the first skill of a duplicated name and drops the other as duplicated (EC-7)', () => {
    skill('a', 'name: twin\ndescription: first')
    skill('b', 'name: twin\ndescription: second')
    const dropped: DroppedEntry[] = []

    expect(readSkillsDir(dir, 'skills', dropped).map((s) => s.description)).toEqual(['first'])
    expect(dropped).toEqual([{ path: 'skills/b/SKILL.md', reason: 'duplicated name' }])
  })

  it('lists a skill directory without SKILL.md as dropped (EC-9)', () => {
    mkdirSync(join(dir, 'empty'))
    skill('safe-skill', 'name: safe-skill\ndescription: stays')
    const dropped: DroppedEntry[] = []

    expect(readSkillsDir(dir, 'skills', dropped).map((s) => s.name)).toEqual(['safe-skill'])
    expect(dropped).toEqual([{ path: 'skills/empty', reason: 'no SKILL.md' }])
  })

  it('drops a SKILL.md whose frontmatter lacks name or description', () => {
    skill('no-description', 'name: no-description')
    writeFileSync(join(dir, 'stray.md'), 'not a skill directory')
    mkdirSync(join(dir, 'no-frontmatter'))
    writeFileSync(join(dir, 'no-frontmatter', 'SKILL.md'), 'just text')
    const dropped: DroppedEntry[] = []

    expect(readSkillsDir(dir, 'skills', dropped)).toEqual([])
    expect(dropped).toEqual([
      { path: 'skills/no-description/SKILL.md', reason: 'frontmatter lacks name or description' },
      { path: 'skills/no-frontmatter/SKILL.md', reason: 'frontmatter lacks name or description' },
    ])
  })

  it('reads a SKILL.md of exactly 262144 bytes and drops one of 262145 bytes (D4)', () => {
    const header = '---\nname: big\ndescription: large\n---\n'
    mkdirSync(join(dir, 'exact'))
    writeFileSync(join(dir, 'exact', 'SKILL.md'), header + 'x'.repeat(262_144 - header.length))
    mkdirSync(join(dir, 'over'))
    writeFileSync(join(dir, 'over', 'SKILL.md'), header.replace('big', 'over') + 'x'.repeat(262_145 - header.length - 1))
    const dropped: DroppedEntry[] = []

    expect(readSkillsDir(dir, 'skills', dropped).map((s) => s.name)).toEqual(['big'])
    expect(dropped).toEqual([{ path: 'skills/over/SKILL.md', reason: 'file over 262144 bytes' }])
  })

  it('follows a symlinked skill directory', () => {
    const elsewhere = join(dir, '..', `${dir.split('/').pop()}-linked`)
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'SKILL.md'), '---\nname: linked\ndescription: through a link\n---\nLinked.\n')
    symlinkSync(elsewhere, join(dir, 'linked'))
    try {
      expect(readSkillsDir(dir, 'skills', []).map((s) => s.name)).toEqual(['linked'])
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('reads CRLF frontmatter and drops one that is not valid YAML', () => {
    mkdirSync(join(dir, 'crlf'))
    writeFileSync(join(dir, 'crlf', 'SKILL.md'), '---\r\nname: crlf\r\ndescription: windows\r\n---\r\nBody.\r\n')
    skill('bad-yaml', 'name: [unclosed\ndescription: x')
    const dropped: DroppedEntry[] = []

    expect(readSkillsDir(dir, 'skills', dropped).map((s) => [s.name, s.body])).toEqual([['crlf', 'Body.\r\n']])
    expect(dropped).toEqual([{ path: 'skills/bad-yaml/SKILL.md', reason: 'frontmatter lacks name or description' }])
  })

  it('does not close the frontmatter on a line that only starts with ---', () => {
    skill('dashes', 'name: dashes\ndescription: |\n  ---x is part of the text')

    expect(readSkillsDir(dir, 'skills', []).map((s) => s.description)).toEqual(['---x is part of the text\n'])
  })

  it('reads nothing from a missing directory', () => {
    expect(readSkillsDir(join(dir, 'absent'), 'skills', [])).toEqual([])
  })
})

/** FR-002, FR-003 (AC-003, AC-004, AC-005): reading a Hermes home. */
describe('readHermesSetup', () => {
  let root = ''

  beforeEach(() => {
    root = copyFixture('hermes', mkdtempSync(join(tmpdir(), 'theoclaw-migration-')))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads instructions, mcp_servers, skills and memories of a Hermes home', () => {
    const setup = readHermesSetup({ root })

    expect(setup.kind).toBe('hermes')
    expect(setup.source).toBe(root)
    expect(setup.instructions.map((file) => file.path)).toEqual(['SOUL.md', 'AGENTS.md'])
    expect(setup.instructions[1]?.text).toContain('team is called Orbit')
    expect(setup.mcpServers).toEqual({
      files: { command: 'npx', args: ['-y', 'fixture-files-server'], env: { PORT: '8080', FILES_TOKEN: 'fixture-secret-hermes-token' } },
      web: { type: 'http', url: 'https://web.example.test/mcp', headers: { Authorization: 'Bearer fixture-secret-hermes-header' } },
    })
    expect(setup.skills.map((skill) => [skill.name, skill.path])).toEqual([['hermes-skill', 'skills/hermes-skill/SKILL.md']])
    expect(setup.memories.map((file) => file.path)).toEqual(['memories/MEMORY.md', 'memories/USER.md'])
    expect(setup.memories[1]?.text).toContain('metric units')
  })

  it('falls back from mcp_servers to mcp.servers and then mcp and stringifies numeric env values', () => {
    const configs = [
      'mcp_servers:\n  one:\n    command: a\n    env:\n      PORT: 8080\n',
      'mcp:\n  servers:\n    one:\n      command: a\n      env:\n        PORT: 8080\n',
      'mcp:\n  one:\n    command: a\n    env:\n      PORT: 8080\n',
      // A `mcp_servers` that is not a map falls through to the next location.
      'mcp_servers: none\nmcp:\n  servers:\n    one:\n      command: a\n      env:\n        PORT: 8080\n',
    ]
    for (const config of configs) {
      writeFileSync(join(root, 'config.yaml'), config)

      const setup = readHermesSetup({ root })

      expect(setup.mcpServers, config).toEqual({ one: { command: 'a', env: { PORT: '8080' } } })
      expect(setup.dropped.filter((entry) => entry.path.startsWith('config.yaml')), config).toEqual([])
    }
  })

  it('lists every entry it does not carry with its reason', () => {
    writeFileSync(join(root, 'SOUL.md'), 'x'.repeat(300_000))
    writeFileSync(
      join(root, 'config.yaml'),
      [
        'mcp_servers:',
        '  neither: { args: [x] }',
        '  both: { command: a, url: "https://h" }',
        '  bad-args: { command: a, args: [1, 2] }',
        '  ftp: { url: "ftp://h/x" }',
        '  slow: { command: a, timeout: 5 }',
      ].join('\n'),
    )

    const setup = readHermesSetup({ root })

    expect(setup.dropped).toEqual([
      { path: 'SOUL.md', reason: 'file over 262144 bytes' },
      { path: 'config.yaml#neither', reason: 'neither command nor url' },
      { path: 'config.yaml#both', reason: 'both command and url' },
      { path: 'config.yaml#bad-args', reason: 'args is not an array of strings' },
      { path: 'config.yaml#ftp', reason: 'url is not http: or https:' },
      { path: 'config.yaml#slow.timeout', reason: 'field not carried' },
      { path: 'skills/no-description/SKILL.md', reason: 'frontmatter lacks name or description' },
      { path: 'platforms', reason: 'channels are not imported' },
      { path: 'channel_directory.json', reason: 'channels are not imported' },
    ])
    expect(setup.instructions.map((file) => file.path)).toEqual(['AGENTS.md'])
    expect(Object.keys(setup.mcpServers)).toEqual(['slow'])
  })

  it('stages a numeric env or header value as it was written, not as YAML reads the number', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'mcp_servers:\n  one:\n    command: a\n    args: [x]\n    env:\n      HEX: 0x1F\n      VERSION: 1.10\n      BIG: 12345678901234567890\n      ON: true\n',
    )

    expect(readHermesSetup({ root }).mcpServers.one).toEqual({
      command: 'a',
      args: ['x'],
      env: { HEX: '0x1F', VERSION: '1.10', BIG: '12345678901234567890', ON: 'true' },
    })
  })

  it('keeps the text of a numeric header, of an aliased env map and of a merged one', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      [
        'defaults: &defaults { PORT: 0x1F }',
        'mcp_servers:',
        '  aliased: { command: a, env: *defaults }',
        '  merged: { command: a, env: { <<: *defaults, EXTRA: 1.10 } }',
        '  web: { url: "https://h/mcp", headers: { X-Version: 1.10 } }',
      ].join('\n'),
    )

    const { mcpServers, dropped } = readHermesSetup({ root })

    expect(mcpServers).toEqual({
      aliased: { command: 'a', env: { PORT: '0x1F' } },
      merged: { command: 'a', env: { PORT: '0x1F', EXTRA: '1.10' } },
      web: { type: 'http', url: 'https://h/mcp', headers: { 'X-Version': '1.10' } },
    })
    expect(dropped.filter((entry) => entry.path.startsWith('config.yaml'))).toEqual([])
  })

  it('falls through a mcp.servers that is not a map to mcp itself', () => {
    writeFileSync(join(root, 'config.yaml'), 'mcp:\n  servers: none\n  one: { command: a }\n')

    const setup = readHermesSetup({ root })

    expect(setup.mcpServers).toEqual({ one: { command: 'a' } })
    expect(setup.dropped).toContainEqual({ path: 'config.yaml#servers', reason: 'not an object' })
  })

  it('reads an empty config.yaml or one with no MCP map as no server and no drop', () => {
    for (const config of ['', 'model: x\n', '- a list\n']) {
      writeFileSync(join(root, 'config.yaml'), config)
      const setup = readHermesSetup({ root })

      expect(setup.mcpServers, config).toEqual({})
      expect(setup.dropped.filter((entry) => entry.path.startsWith('config.yaml')), config).toEqual([])
    }
  })

  it('lists a config.yaml over 262144 bytes as dropped', () => {
    writeFileSync(join(root, 'config.yaml'), `# ${'x'.repeat(262_144)}\n`)

    expect(readHermesSetup({ root }).dropped).toContainEqual({ path: 'config.yaml', reason: 'file over 262144 bytes' })
  })

  it('never puts a fixture secret in a dropped entry', () => {
    writeFileSync(
      join(root, 'config.yaml'),
      'mcp_servers:\n  one: { command: a, env: { T: { v: fixture-secret-hermes-token } }, extra: fixture-secret-hermes-token }\n',
    )

    const dropped = JSON.stringify(readHermesSetup({ root }).dropped)

    for (const secret of FIXTURE_SECRETS) expect(dropped).not.toContain(secret)
  })

  it('drops an entry whose env value is empty', () => {
    writeFileSync(join(root, 'config.yaml'), 'mcp_servers:\n  one:\n    command: a\n    env:\n      KEY:\n')

    expect(readHermesSetup({ root }).dropped).toContainEqual({ path: 'config.yaml#one', reason: 'env value is not a string, number or boolean' })
  })

  it('takes the last value of a repeated key, as Hermes does', () => {
    writeFileSync(join(root, 'config.yaml'), 'mcp_servers:\n  one: { command: a }\n  one: { command: b }\n')

    const setup = readHermesSetup({ root })

    expect(setup.mcpServers).toEqual({ one: { command: 'b' } })
    expect(setup.dropped.filter((entry) => entry.path.startsWith('config.yaml'))).toEqual([])
  })

  it('lists a config.yaml that does not parse as dropped and reads the rest', () => {
    writeFileSync(join(root, 'config.yaml'), 'mcp_servers: [unclosed\n')

    const setup = readHermesSetup({ root })

    expect(setup.dropped).toContainEqual({ path: 'config.yaml', reason: 'not valid YAML' })
    expect(setup.mcpServers).toEqual({})
    expect(setup.skills.map((skill) => skill.name)).toEqual(['hermes-skill'])
  })

  it('reads an empty Hermes home as nothing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'theoclaw-migration-'))
    try {
      expect(readHermesSetup({ root: empty })).toEqual({
        kind: 'hermes',
        source: empty,
        instructions: [],
        mcpServers: {},
        skills: [],
        memories: [],
        dropped: [],
      })
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
