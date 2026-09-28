import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
const PACKAGE_ROOT = resolve(__dirname, '../../packages/theo')

/**
 * Each bare specifier a rendered entry can import, DERIVED from the package's own `exports`.
 *
 * It was a hand-written list of five until 2026-09-28. `596daa69c` changed the emitted imports from
 * `theokit/server` to the narrow `theokit/server/scan`, `/http` and `/rate-limit` — a fix for a real
 * bundler failure — and this list did not move. The rewrite below passed the unknown specifier
 * through, so the entry ran with a bare `theokit` import in a temp directory and failed with
 * `Cannot find package 'theokit'`: a message about the directory rather than about the map, three
 * hops from the cause.
 *
 * Derived, it cannot drift. A subpath the package exports is a subpath this resolves, and one it does
 * not export is refused below rather than passed on.
 */
const BUILT: Record<string, string> = Object.fromEntries(
  Object.entries(
    JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')).exports as Record<
      string,
      { import?: string } | string
    >,
  )
    .filter(
      (entry): entry is [string, { import: string }] =>
        entry[0].startsWith('./') && typeof (entry[1] as { import?: string })?.import === 'string',
    )
    .map(([subpath, target]) => [
      `theokit${subpath.slice(1)}`,
      resolve(PACKAGE_ROOT, target.import),
    ]),
)

function againstTheBuild(source: string): string {
  return source.replace(
    /^(\s*import[^\n]*?from\s+)'([^']+)'/gm,
    (whole: string, prefix: string, specifier: string) => {
      if (specifier in BUILT) return `${prefix}'${pathToFileURL(BUILT[specifier]).href}'`
      // Fail-fast, per `rules/error-handling.md`. Passing an unmapped `theokit` specifier through is
      // what turned a one-line map omission into `Cannot find package 'theokit'` from a temp
      // directory. The specifier IS the diagnosis, so it is named here rather than three hops later.
      if (specifier === 'theokit' || specifier.startsWith('theokit/')) {
        throw new Error(
          `the rendered entry imports '${specifier}', which packages/theo does not export. ` +
            `Add the subpath to the package's \`exports\`, or stop emitting it.`,
        )
      }
      return whole
    },
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

describe('a throwing createContext answers 500, not anonymously (B-237, B-254)', () => {
  it('test_the_caller_gets_a_shaped_500_rather_than_an_anonymous_refusal', async () => {
    const handler = await bootDeployedEntry()

    const response = await handler(new Request('http://x/api/agents/chat/approvals'))
    const body = (await response.json()) as { error?: { code?: string; message?: string } }

    // 403 would mean the failure was absorbed into an anonymous caller — indistinguishable, to an
    // operator reading a log, from a caller who simply sent no credential. 200 would serve a
    // stranger while the identity source was down.
    expect(response.status, `a createContext that throws answered ${String(response.status)}`).toBe(
      500,
    )

    // B-254's second bullet: the response must SAY which of the two it is. A bare 500 would be
    // loud and still leave the operator guessing.
    expect(
      body.error?.code,
      'the envelope does not distinguish a broken identity source from a refused caller',
    ).toBe('IDENTITY_UNAVAILABLE')
    expect(body.error?.message).toContain('createContext')
  })
})
