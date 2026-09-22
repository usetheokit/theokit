/**
 * Every emitted deploy entry is a loadable ES module.
 *
 * A generated file nobody parses is a file nobody has run. `vercel.ts` declared
 * `const headers` twice in one function scope from #382 (2026-08-20) until
 * 2026-08-21, so `renderVercelFunctionEntry()` produced a module that Node
 * refused with `SyntaxError: Identifier 'headers' has already been declared`.
 * Twelve suites asserted on that string's contents and every one of them
 * passed, because `toContain` does not care whether the string is a program.
 *
 * `node --check` is the parser the runtime uses, so a green run here is the
 * strongest statement available without a deployment: the artifact loads. It
 * says nothing about behaviour — that is what `adapter-security-headers.test.ts`
 * exercises, by importing these same entries and reading a real response.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'

const ENTRIES: Record<string, () => string> = {
  'cloudflare (ssrStreaming off)': () => renderCloudflareWorkerEntry({ ssrStreaming: false }),
  'cloudflare (ssrStreaming on)': () =>
    renderCloudflareWorkerEntry({
      ssrStreaming: true,
      htmlHead: '<!doctype html><html><head></head><body>',
      htmlTail: '</body></html>',
    }),
  vercel: () => renderVercelFunctionEntry(),
  netlify: () => renderNetlifyFunction(),
  bun: () => renderBunEntry(3000),
  'deno-deploy': () => renderDenoEntry(3000),
  'aws-lambda': () => renderAwsLambdaEntry(),

  // #425 — the same six with the runtime-config module the build emits for an app that declares
  // `plugins` or `serialization`. That entry grows a top-level import, two module-scope constants
  // and an `await` inside the `executeRoute` literal; each is a place a template can produce
  // something that no longer parses, and none of them is exercised by the variants above.
  'cloudflare (runtime config)': () =>
    renderCloudflareWorkerEntry({ ssrStreaming: false, runtimeConfigModule: RUNTIME_CONFIG }),
  'vercel (runtime config)': () =>
    renderVercelFunctionEntry({ runtimeConfigModule: RUNTIME_CONFIG }),
  'netlify (runtime config)': () => renderNetlifyFunction({ runtimeConfigModule: RUNTIME_CONFIG }),
  'bun (runtime config)': () => renderBunEntry(3000, { runtimeConfigModule: RUNTIME_CONFIG }),
  'deno-deploy (runtime config)': () =>
    renderDenoEntry(3000, { runtimeConfigModule: RUNTIME_CONFIG }),
  'aws-lambda (runtime config)': () =>
    renderAwsLambdaEntry({ runtimeConfigModule: RUNTIME_CONFIG }),

  'cloudflare (with an agent)': () =>
    renderCloudflareWorkerEntry({ ssrStreaming: false, agents: AGENTS }),
  // B-185 — the identity module is baked like the agents beside it, and a wrong specifier or a
  // malformed factory call is a BUILD failure rather than a request one. This variant is what
  // catches it, and the one above cannot: with no `contextModule` the generator emits no import.
  'cloudflare (agents + a baked context module)': () =>
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      agents: AGENTS,
      contextModule: 'server/context.ts',
    }),
  // SI-019 — the CROSS-PRODUCT, not one axis at a time. Every entry above varies a single feature,
  // and a defect that needs two of them together is invisible to all of them: the subject-resolver
  // factory carries the plugin runner only when a runtime-config module exists, and it carries the
  // baked-context call only when `contextModule` does. The combination is what put `await` inside a
  // non-async function, and this matrix had no row that rendered both at once — so the entry
  // shipped unparseable on three targets and the 15 rows above stayed green.
  'cloudflare (agents + context module + runtime config)': () =>
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      agents: AGENTS,
      contextModule: 'server/context.ts',
      runtimeConfigModule: RUNTIME_CONFIG,
    }),
  // Kept although it does NOT catch the defect the row above does: with `contextModule` undefined
  // the emission takes the `const resolveSubject = undefined` branch and emits no `await` at all,
  // so it stays green under that mutation. Verified by the inventory judge, which is the reason
  // this comment exists rather than the row silently reading as a second guard. What it does cover
  // is the runtime-config import landing in an entry whose identity branch is the empty one.
  'cloudflare (agents + runtime config, no context module)': () =>
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      agents: AGENTS,
      runtimeConfigModule: RUNTIME_CONFIG,
    }),
  // Bun and Deno take no `agents`: they scan at request time, as they already do for routes, so
  // their entry carries the branch unconditionally and an agent added later needs no rebuild.
  'bun (agent branch)': () => renderBunEntry(3000),
  'deno-deploy (agent branch)': () => renderDenoEntry(3000),
}

/** What the build writes beside the entry; the specifier is what the emitted source imports. */
const RUNTIME_CONFIG = './theo.runtime-config.mjs'

/**
 * One agent, as the build scans it (#367). The three targets that can serve one each grow a static
 * import, a name→module table and a branch ahead of the route table; every one of those is a place
 * a template can emit something that no longer parses.
 */
const AGENTS = [{ filePath: 'agents/chat.ts', agentPath: '/api/agents/chat', name: 'chat' }]

describe('every emitted deploy entry parses as an ES module', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theo-adapter-parse-'))

  for (const [label, render] of Object.entries(ENTRIES)) {
    it(`${label} loads without a SyntaxError`, () => {
      const file = join(dir, `${label.replace(/[^a-z0-9]+/gi, '-')}.mjs`)
      writeFileSync(file, render())

      // `--check` resolves nothing, so an unresolvable bare specifier cannot
      // masquerade as a passing parse and a real SyntaxError cannot hide behind
      // one.
      expect(() => execFileSync(process.execPath, ['--check', file])).not.toThrow()
    })
  }
})
