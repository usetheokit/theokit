import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'

/**
 * B-185, second Definition-of-done bullet: the approvals scoping is exercised ON A DEPLOY TARGET
 * and not only under `theokit start`.
 *
 * The item recorded on 2026-09-21 that this could not pass, because the deploy fragment called
 * `mountAgent` without a `resolveSubject` and every deployed policy therefore saw `subject: null`.
 * Re-measured 2026-09-22: `deployed-agents.ts` supplies one at `:308` and `:329`. The blocker is
 * gone and the exercise is what remains.
 *
 * ## Why this drives the BUILT package and not a stub
 *
 * The sibling integration suites replace every bare import with one stub module, which is right for
 * asserting the SHAPE of generated code without a runtime. It is wrong here: a stubbed
 * `handleListApprovals` would return whatever the stub returns, and the assertion would be about
 * the fixture. The scoping is the subject, so the entry runs against `packages/theo/dist`.
 *
 * ## Why seeding the registry from the test works
 *
 * `process-singleton.ts` keys on `Symbol.for(NAMESPACE + key)` on `globalThis`, and its own comment
 * says why: a key that is equal across every module instance. So the registry this file seeds is
 * the registry the emitted entry resolves, even though they reach it through different import
 * paths.
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

let root: string
let previousNodeEnv: string | undefined

/**
 * The slot `processSingleton` writes into. Reached by symbol rather than by import because
 * `getApprovalRegistry` is deliberately NOT part of any public subpath — measured against the
 * built package: `dist/server/agent/index.js` exports 18 names and none of them is it. Importing
 * the emitted chunk that defines it would bind this test to a build artifact whose name changes
 * every time the bundler splits differently; the symbol is the contract the module itself relies on.
 */
const REGISTRY_SLOT = Symbol.for('theokit.singleton.approval-registry')

interface SeedableRegistry {
  register: (id: string, opts: Record<string, unknown>) => Promise<unknown>
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'theo-scoped-listing-'))
  mkdirSync(join(root, 'agents'), { recursive: true })
  mkdirSync(join(root, 'server'), { recursive: true })
  mkdirSync(join(root, '.theokit', 'bun'), { recursive: true })

  // Every real theokit project has one, and the templates declare `"type": "module"`
  // (`packages/create-theokit/templates/default/package.json.tmpl`). A fixture without one is not a
  // project shape the framework ever meets: `importUserModule` falls back to `tsx` when a plain
  // `import()` of a `.ts` cannot resolve, and what tsx does with an undeclared module kind is its
  // decision rather than ours. Declaring it makes the fixture faithful and the loader's branch
  // irrelevant.
  writeFileSync(
    join(root, 'package.json'),
    `{"type":"module","name":"theo-scoped-listing-fixture"}\n`,
  )

  // An agent whose policy READS the subject, so identity governs access rather than decorating it.
  writeFileSync(
    join(root, 'agents', 'chat.js'),
    `export const policy = ({ subject }) => subject !== null\n` +
      `export default { model: 'claude-sonnet-4-6', tools: [] }\n`,
  )
  // The application's own identity resolution, located from disk by the scanned host.
  writeFileSync(
    join(root, 'server', 'context.ts'),
    `export function createContext({ request }) {\n` +
      `  const h = request?.headers\n` +
      `  const who = typeof h?.get === 'function' ? h.get('x-test-subject') : h?.['x-test-subject']\n` +
      `  return who ? { subject: { id: who } } : {}\n` +
      `}\n`,
  )
})

afterAll(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
  delete (globalThis as Record<string, unknown>).Bun
})

type Handler = (request: Request) => Promise<Response>

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
    againstTheBuild(
      // Both are NAMES relative to the project root, not paths — `scanAgents(projectRoot,
      // agentsDirName)` joins them onto the root. An absolute value silently resolves to a
      // directory that does not exist and every agent route 404s; measured while writing this
      // test, and registered separately rather than worked around here.
      renderBunEntry(3000, { agentsDir: 'agents', serverDir: 'server' }),
    ),
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

async function ask(handler: Handler, subject: string | undefined): Promise<Response> {
  const headers: Record<string, string> = subject === undefined ? {} : { 'x-test-subject': subject }
  return handler(new Request('http://x/api/agents/chat/approvals', { headers }))
}

async function listedFor(handler: Handler, subject: string): Promise<string[]> {
  const response = await ask(handler, subject)
  if (response.status !== 200) {
    throw new Error(
      `${subject} was refused with ${String(response.status)}: ${await response.text()}`,
    )
  }
  const body = (await response.json()) as { approvals?: { approvalId: string }[] }
  return (body.approvals ?? []).map((a) => a.approvalId).sort((x, y) => x.localeCompare(y))
}

describe('a deployed approvals listing is scoped to its caller (B-185)', () => {
  it('test_the_three_callers_see_three_different_listings', async () => {
    const handler = await bootDeployedEntry()

    // An anonymous caller is refused BEFORE the listing is reached: the deployed host resolves
    // `ctx.subject` and hands it to the agent's own policy, which sees `null`. This is the half of
    // B-185 that could not hold at all before the deploy fragment supplied a `resolveSubject` —
    // every deployed policy used to see `null` for everybody, so refusing here proved nothing.
    const refused = await ask(handler, undefined)
    expect(refused.status, 'an unauthenticated caller was not refused').toBe(403)

    // One authenticated request so the host builds its registry through `processSingleton`; the
    // slot stays empty while the policy refuses, because the listing is never reached.
    await listedFor(handler, 'alice')

    const registry = (globalThis as Record<symbol, unknown>)[REGISTRY_SLOT] as
      | SeedableRegistry
      | undefined
    expect(registry, 'the deployed entry never built an approval registry').toBeDefined()

    const HOUR = 3_600_000
    const shared = { timeoutMs: HOUR, onTimeout: 'abort' as const }
    // Deliberately NOT awaited: `register` resolves when the approval is SETTLED, and these three
    // are never settled — awaiting one would block until its one-hour timeout. The `catch` is not
    // decoration either: a floating promise that rejects at teardown would surface as an unhandled
    // rejection in whatever test happened to be running next.
    const seeded = [
      registry?.register('a-1', { ...shared, toolName: 'deploy', owner: 'alice' }),
      registry?.register('b-1', { ...shared, toolName: 'refund', owner: 'bob' }),
      registry?.register('p-1', { ...shared, toolName: 'search' }),
    ]
    for (const pending of seeded) pending?.catch(() => undefined)

    const alice = await listedFor(handler, 'alice')
    const bob = await listedFor(handler, 'bob')

    expect(alice, 'alice did not see exactly her own plus the ownerless one').toEqual([
      'a-1',
      'p-1',
    ])
    expect(bob, "bob saw alice's approval, or lost his own").toEqual(['b-1', 'p-1'])
  })
})
