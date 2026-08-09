import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { McpFileError, loadMcpJson } from '../../src/bridge/mcp-file.js'

/**
 * M112 — `.mcp.json` degrades per ENTRY, and the remote transport crosses.
 *
 * ## The two defects this file closes
 *
 * **(A) The `stdio only` scope had a written exit criterion, and it had expired.** This module's
 * docblock said: *"remote transports (HTTP/SSE) are deliberately out … **widening later is
 * additive**"*, and the reason was being an **exact** substitute for the hand-written loaders it
 * replaced. That migration finished in M107.
 *
 * **(B) One unsupported entry killed the whole map.** Measured before M112, with a synthetic file:
 * a perfectly valid stdio server + one `type: 'http'` produced `McpFileError`, and the stdio server
 * was lost with it. Fail-closed at the **wrong radius** — refusing *one entry* is correct; refusing
 * *the file* turns "that server is not supported" into "you have no MCP at all".
 *
 * ## The finding that shrank the milestone
 *
 * The plan was going to add `@modelcontextprotocol/sdk` and build a transport. The edge-case review
 * measured that the **SDK already ships all of it**:
 *
 * ```ts
 * type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig
 * type McpHttpServerConfig = {
 *   type?: 'http' | 'sse'; url: string
 *   headers?: Record<string,string>          // "Passed through. `Authorization` works here."
 *   auth?: McpAuthConfig                     // full OAuth 2.1 PKCE
 *   requestTimeoutMs?: number                // AbortSignal.timeout, typed error, 30_000 default
 * }
 * ```
 *
 * It is **field for field** what the blueprint derived independently from `gemini-cli`, `opencode`
 * and `codex`. M112 therefore **builds no transport** — it stops narrowing: this module declared its
 * own `McpServerConfig`, narrower than the SDK's, and refused what the SDK accepts.
 *
 * ## Why the peers decide it this way
 *
 * Both TS peers contain the failure **per server**, through different idioms: `gemini-cli` uses
 * `Promise.all` over promises that **never reject** (`connectAndDiscover` closes the client, emits a
 * diagnostic naming the server, marks `DISCONNECTED` and does not rethrow); `opencode` returns
 * `Effect.succeed({ status: 'failed' })`. **Neither** lets one server take down the others.
 *
 * ## The tension with `error-handling.md § 2`, spelled out
 *
 * That rule forbids swallowing errors. This **is not swallowing** — it is failing at the right
 * radius. The error is still typed, still names the entry, and is still visible through the warning
 * channel. What changes is the radius: it was the file, it becomes the entry. An **unparseable** file
 * (broken JSON, an `mcpServers` that is not an object) still throws, because there are no entries to
 * separate there.
 */
describe('M112 — .mcp.json degrades per entry', () => {
  let dir: string
  let warnings: string[]

  const writeIt = (doc: unknown): void => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify(doc))
  }
  const load = () => loadMcpJson(dir, { onWarn: (m: string) => warnings.push(m) })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'm112-'))
    warnings = []
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('test_floor_the_stdio_happy_path_stays_intact', () => {
    // ANTI-VACUITY FLOOR: without it, "the good entry survived" would be satisfied by a parser that
    // returns everything without validating anything. The path that already worked must keep working.
    writeIt({ mcpServers: { local: { command: 'echo', args: ['ok'], cwd: '/tmp' } } })
    const map = load()
    expect(Object.keys(map)).toEqual(['local'])
    expect(map.local).toEqual({ command: 'echo', args: ['ok'], cwd: '/tmp' })
    expect(warnings, 'the happy path must warn about nothing').toEqual([])
  })

  it('test_an_INVALID_entry_does_not_kill_the_valid_ones', () => {
    // DEFECT B. Before M112 this threw `McpFileError` and lost both.
    writeIt({
      mcpServers: {
        'stdio-that-works': { command: 'echo', args: ['ok'] },
        'no-command-no-url': { args: ['x'] },
      },
    })
    const map = load()
    expect(
      Object.keys(map),
      'the good entry was lost along with the bad one — fail-closed at the wrong radius',
    ).toEqual(['stdio-that-works'])
  })

  it('test_the_omitted_entry_is_NAMED_in_the_warning', () => {
    // Without this assertion, "not throwing" slides into "ignoring silently", which is fail-OPEN —
    // the plan's risk R-2. The warning is what keeps the error visible after narrowing the radius.
    writeIt({
      mcpServers: { good: { command: 'echo' }, 'bad-with-nothing': { args: ['x'] } },
    })
    load()
    expect(warnings, 'the omission was silent').toHaveLength(1)
    expect(warnings.join(' '), 'the warning does not name the omitted entry').toContain(
      'bad-with-nothing',
    )
  })

  it('test_the_HTTP_transport_crosses_INTACT', () => {
    // DEFECT A. The shape is the SDK's (`McpHttpServerConfig`), not one invented here — M112 stops
    // narrowing instead of building.
    const serverEntry = {
      type: 'http' as const,
      url: 'https://example.invalid/mcp',
      headers: { Authorization: 'Bearer SENTINEL-M112' },
      requestTimeoutMs: 5_000,
    }
    writeIt({ mcpServers: { remoto: serverEntry } })
    const map = load()
    expect(
      map.remoto,
      'the HTTP entry did not cross intact — the layer is still narrowing what the SDK accepts',
    ).toEqual(serverEntry)
    expect(warnings).toEqual([])
  })

  it('test_a_url_without_type_crosses_and_the_SDK_decides_the_default', () => {
    // `gemini-cli` makes a `url` without a `type` fall back to HTTP. The layer does NOT decide that —
    // it forwards, and the default is the SDK's. Inventing the default here would be a second oracle
    // over the same fact.
    writeIt({ mcpServers: { r: { url: 'https://example.invalid/mcp' } } })
    expect(load().r).toEqual({ url: 'https://example.invalid/mcp' })
  })

  it('test_type_sse_also_crosses', () => {
    writeIt({ mcpServers: { r: { type: 'sse', url: 'https://example.invalid/sse' } } })
    expect(load().r).toEqual({ type: 'sse', url: 'https://example.invalid/sse' })
  })

  it('test_stdio_and_remote_COEXIST_in_the_same_file', () => {
    // The exact shape of the real `.mcp.json` that motivated the milestone: one stdio and one HTTP
    // side by side.
    writeIt({
      mcpServers: {
        'add-fixture': { command: 'npx', args: ['fixture'] },
        'theo-skills': {
          type: 'http',
          url: 'https://example.invalid/mcp',
          headers: { Authorization: 'Bearer X' },
        },
      },
    })
    const map = load()
    expect([...Object.keys(map)].sort((a, b) => a.localeCompare(b))).toEqual([
      'add-fixture',
      'theo-skills',
    ])
    expect(warnings, 'the real-case file must produce no warning at all').toEqual([])
  })

  it('test_NEGATIVE_an_unknown_type_is_omitted_and_named', () => {
    writeIt({
      mcpServers: {
        good: { command: 'echo' },
        exotic: { type: 'carrier-pigeon', url: 'https://x.invalid' },
      },
    })
    const map = load()
    expect(Object.keys(map)).toEqual(['good'])
    expect(warnings.join(' ')).toContain('exotic')
  })

  it('test_NEGATIVE_url_and_command_together_are_omitted_and_named', () => {
    // An ambiguous config is not guessed — the SDK has a discriminated union, and an entry satisfying
    // both branches is neither.
    writeIt({
      mcpServers: {
        good: { command: 'echo' },
        ambiguous: { command: 'echo', url: 'https://x.invalid' },
      },
    })
    expect(Object.keys(load())).toEqual(['good'])
    expect(warnings.join(' ')).toContain('ambiguo')
  })

  it('test_NEGATIVE_a_url_that_is_not_a_url_is_omitted_and_named', () => {
    writeIt({ mcpServers: { good: { command: 'echo' }, r: { type: 'http', url: 'not-a-url' } } })
    expect(Object.keys(load())).toEqual(['good'])
    expect(warnings.join(' ')).toContain('r')
  })

  it('test_NEGATIVE_the_header_value_NEVER_appears_in_the_warning', () => {
    // The plan's D5. The peers DIVERGE here — `gemini-cli` redacts in 18 places, `opencode` in ZERO —
    // and a peer is not precedent for security. The INTERNAL precedent decides: `AuthProvider` states
    // it never exposes token material. `.mcp.json` is a PROJECT file, which can be committed.
    writeIt({
      mcpServers: {
        leaker: {
          type: 'http',
          url: 'https://ok.invalid/mcp',
          headers: { Authorization: 12345 },
        },
      },
    })
    load()
    // The URL is VALID on purpose. The first version used `url: 'not-a-url'`, and `validateRemote`
    // returns on the first error — the warning was about the URL and **never touched `headers`**. The
    // review proved it by mutation: swapping the headers branch's message for one that dumps the
    // value kept all 28 tests green. A control that never reaches the branch it would protect is
    // indistinguishable from no control (`anti-forgetting-mechanism.md § 5.3`).
    expect(
      warnings,
      'the headers branch did not fire — the test is back to not reaching it',
    ).toHaveLength(1)
    expect(warnings.join(' '), 'the warning must name the entry').toContain('leaker')
    expect(warnings.join(' '), 'the warning must speak of the field SHAPE').toContain('headers')
    expect(warnings.join(' '), 'the warning leaked the header content').not.toContain('12345')

    // The earlier case stays covered, as a SEPARATE scenario: an invalid URL with a header present.
    warnings.length = 0
    writeIt({
      mcpServers: {
        outro: {
          type: 'http',
          url: 'not-a-url',
          headers: { Authorization: 'Bearer SECRET-XYZ-123' },
        },
      },
    })
    load()
    expect(warnings.join(' '), 'the warning leaked the header value').not.toContain(
      'SECRET-XYZ-123',
    )
  })

  it('test_NEGATIVE_an_unparseable_file_STILL_throws', () => {
    // What separates "the right radius" from fail-open: with no entries to separate, no degradation
    // is possible.
    writeFileSync(join(dir, '.mcp.json'), '{ this is not json')
    expect(() => load()).toThrow(McpFileError)
  })

  it('test_NEGATIVE_an_mcpServers_that_is_not_an_object_STILL_throws', () => {
    writeIt({ mcpServers: ['this', 'is', 'an', 'array'] })
    expect(() => load()).toThrow(McpFileError)
  })

  it('test_a_missing_file_returns_empty_with_NO_error', () => {
    // MCP is opt-in — a missing file was never an error, and still is not.
    expect(loadMcpJson(join(dir, 'does-not-exist'))).toEqual({})
  })

  it('test_omitting_onWarn_falls_back_to_stderr_NEVER_to_silence', () => {
    // The review's HIGH-1: an optional `onWarn` left the omission SILENT when the caller did not
    // subscribe — and the only production caller did not. The whole defence against
    // `error-handling.md § 2` rested on the sentence "the error stays visible through the channel";
    // with no subscriber, it did not.
    const original = process.stderr.write.bind(process.stderr)
    const captured: string[] = []
    process.stderr.write = ((s: string) => {
      captured.push(s)
      return true
    }) as typeof process.stderr.write
    try {
      writeIt({ mcpServers: { good: { command: 'echo' }, bad: {} } })
      expect(Object.keys(loadMcpJson(dir))).toEqual(['good'])
    } finally {
      process.stderr.write = original
    }
    expect(
      captured.join(' '),
      'the omission was silent without `onWarn` — that is fail-open',
    ).toContain('bad')
  })

  it('test_SECURITY_the_files_envPolicy_does_NOT_cross', () => {
    // The review's BLOCKER-1. `envPolicy: 'all'` disables the scrub that stops a third-party binary
    // exfiltrating host secrets through the environment — and `.mcp.json` is a PROJECT file. M112's
    // first version forwarded the raw object and let that field cross.
    writeIt({ mcpServers: { s: { command: 'node', args: ['x.js'], envPolicy: 'all' } } })
    const serverEntry = load().s as unknown as Record<string, unknown>
    expect(
      'envPolicy' in serverEntry,
      '`.mcp.json` managed to disable the host secret scrub — a repository can now hand ' +
        'ANTHROPIC_API_KEY and NPM_TOKEN to a third-party binary with one line of JSON',
    ).toBe(false)
    expect(serverEntry, 'the rest of the stdio entry must cross normally').toEqual({
      command: 'node',
      args: ['x.js'],
    })
  })

  it('test_SECURITY_an_unknown_field_does_NOT_cross', () => {
    // The allowlist is the RULE, not a list of forbidden things: a field nobody anticipated does not
    // pass either. Without this, the SDK's next dangerous field would cross on its own the day it was
    // created.
    writeIt({
      mcpServers: {
        s: { command: 'node', campoInventado: { x: 1 } },
        r: { type: 'http', url: 'https://ok.invalid/mcp', anotherInvented: 'y' },
      },
    })
    const m = load()
    expect(m.s).toEqual({ command: 'node' })
    expect(m.r).toEqual({ type: 'http', url: 'https://ok.invalid/mcp' })
  })
})
