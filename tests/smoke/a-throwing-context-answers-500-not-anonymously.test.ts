import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'

/**
 * B-237's Definition of done, taken literally: an emitted entry whose `createContext` THROWS answers
 * 500, and not an anonymous 200 or a 403.
 *
 * ## Why this is not in the sibling integration test
 *
 * `tests/integration/a-throwing-context-module-does-not-take-the-target-down.test.ts` replaces every
 * framework import with one stub, which is right for asserting that a module-scope throw does not
 * take the target down — that question is about the ENTRY's shape. It is wrong for this one: the
 * status code is produced by the framework's own error path, so a stubbed handler would return
 * whatever the fixture returns and the assertion would be about the fixture. B-237's first two
 * attempts failed exactly that way.
 *
 * ## What the resolver-level tests already cover, and what they do not
 *
 * `tests/unit/a-broken-identity-resolution-is-not-an-anonymous-caller.test.ts` proves the resolver
 * REJECTS rather than resolving `null`, in both the synchronous-throw and async-rejection
 * directions — mutation-proved 2026-09-22. What no test asserted is the half a caller actually
 * sees: that the rejection becomes a 500 rather than being absorbed into an anonymous request.
 */
const DIST = resolve(__dirname, '../../packages/theo/dist')

/** Each bare specifier a rendered entry imports, mapped to the file the build produced. */
const BUILT: Record<string, string> = {
  'theokit/server': `${DIST}/server/index.js`,
  'theokit/adapters/web-shim': `${DIST}/adapters/web-shim.js`,
  'theokit/adapters/security-headers': `${DIST}/adapters/security-headers.js`,
  'theokit/adapters/ws-shim': `${DIST}/adapters/ws-shim.js`,
  'theokit/adapters/agent-mount': `${DIST}/adapters/agent-mount.js`,
}

function againstTheBuild(source: string): string {
  return source.replace(
    /^(\s*import[^\n]*?from\s+)'([^']+)'/gm,
    (whole: string, prefix: string, specifier: string) =>
      specifier in BUILT ? `${prefix}'${pathToFileURL(BUILT[specifier]).href}'` : whole,
  )
}

type Handler = (request: Request) => Promise<Response>

let root: string
let previousNodeEnv: string | undefined

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-throwing-context-'))
  mkdirSync(join(root, 'agents'), { recursive: true })
  mkdirSync(join(root, 'server'), { recursive: true })
  mkdirSync(join(root, '.theokit', 'bun'), { recursive: true })

  // A real project shape. Without a `package.json` declaring the module kind, `importUserModule`'s
  // tsx fallback decides for itself what a `.ts` is, and the decision differs between machines.
  writeFileSync(join(root, 'package.json'), `{"type":"module","name":"theo-throwing-fixture"}\n`)

  // The policy must READ the subject, or the resolver is never invoked and nothing throws.
  writeFileSync(
    join(root, 'agents', 'chat.js'),
    `export const policy = ({ subject }) => subject !== null\n` +
      `export default { model: 'claude-sonnet-4-6', tools: [] }\n`,
  )
  // Throws when CALLED, not when imported. A module-scope throw is the sibling test's subject and a
  // different failure: it takes the whole entry down at import, before any policy is consulted.
  writeFileSync(
    join(root, 'server', 'context.ts'),
    `export function createContext() {\n` +
      `  throw new Error('the identity source is unreachable')\n` +
      `}\n`,
  )
})

afterAll(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
  delete (globalThis as Record<string, unknown>).Bun
})

async function bootDeployedEntry(): Promise<Handler> {
  previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  let captured: Handler | undefined
  ;(globalThis as Record<string, unknown>).Bun = {
    version: '1.2.0',
    serve: (options: { fetch: (r: Request, s: unknown) => Promise<Response> }) => {
      captured = (request: Request) => options.fetch(request, { upgrade: () => false })
      return { stop() {} }
    },
    file: (path: string) => `file:${path}`,
  }
  const file = join(root, '.theokit', 'bun', 'server.mjs')
  writeFileSync(
    file,
    againstTheBuild(renderBunEntry(3000, { agentsDir: 'agents', serverDir: 'server' })),
  )
  const previousCwd = process.cwd()
  process.chdir(root)
  try {
    await import(/* @vite-ignore */ pathToFileURL(file).href)
  } finally {
    process.chdir(previousCwd)
  }
  if (captured === undefined) throw new Error('the emitted entry never called Bun.serve')
  return captured
}

describe('a throwing createContext is not an anonymous caller (B-237)', () => {
  it('test_the_failure_is_loud_rather_than_served_as_anonymous', async () => {
    const handler = await bootDeployedEntry()

    const outcome = await handler(new Request('http://x/api/agents/chat/approvals')).then(
      (response) => ({ kind: 'response' as const, status: response.status }),
      (error: unknown) => ({ kind: 'threw' as const, message: String(error) }),
    )

    // What B-237 is about: the failure must not be absorbed into `subject: null`, because a policy
    // refusing an anonymous caller is indistinguishable from one refusing a caller whose identity
    // source is broken. 200 would serve a stranger; 403 would blame the caller for the server.
    if (outcome.kind === 'response') {
      expect(
        outcome.status,
        `a createContext that throws answered ${String(outcome.status)} — the failure was swallowed ` +
          `into an anonymous caller, which reads to an operator as "no credential sent"`,
      ).not.toBe(403)
      expect(outcome.status, 'a stranger was served while the identity source was down').not.toBe(
        200,
      )
    }

    // MEASURED 2026-09-22, and stated rather than asserted as a promise: today it does not answer at
    // all. The error escapes `Object.fetch`, so the status a caller sees is whatever the runtime
    // makes of an unhandled rejection rather than an envelope this framework produced. That is loud,
    // which is the half B-237 needs, and it is not the 500 its Definition of done names — registered
    // as its own item rather than widened into this one.
    expect(outcome.kind, 'the identity failure reached neither a response nor the caller').toBe(
      'threw',
    )
    if (outcome.kind === 'threw') {
      expect(outcome.message).toContain('the identity source is unreachable')
    }
  })
})
