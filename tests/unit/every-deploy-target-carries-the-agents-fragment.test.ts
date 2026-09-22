import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'

/**
 * B-235. B-185 made `GET /api/agents/<name>/approvals` reachable on a deploy target and reached
 * three of six. `the-agents-fragment-reaches-three-of-six-deploy-targets.test.ts` characterised
 * that limit in both directions, deliberately, so it could not shrink in silence.
 *
 * This file REPLACES the limit with the property. It is one loop over every target rather than
 * two lists, because two lists is how a seventh adapter gets added to neither: the author picks
 * the list that makes their test pass, and `DOES_NOT` is the one that costs nothing.
 *
 * The premise B-235 was filed on turned out to be wrong, and the measurement is worth keeping
 * because it is what made the fix cheap. The item recorded that the three "are NOT a forgotten
 * copy-paste" — vercel threading a Node `nodeReq`, netlify neither that nor a `Request`,
 * aws-lambda one `Request` — and concluded the Web-shaped branch could not reach them. Re-read on
 * 2026-09-21: netlify's emitted handler is `(request, context)` and already RECEIVES a Web
 * `Request`; aws-lambda already builds one with `eventV2ToRequest(event)` for its CORS matcher;
 * vercel already builds one at `webRequest` and hands it to `createWebShim`. All three had the
 * shape the fragment needs. Counting `new Request` occurrences measured how each entry OBTAINS a
 * request, which is not the same question as whether it has one.
 */
const AGENTS = [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }]

/** The call that makes the aux dispatcher reachable — the whole of what B-185 added. */
const AUX_DISPATCH = 'matchAgentAuxRoute'

/** Every Web deploy target this framework emits an entry for. */
const TARGETS = [
  ['cloudflare', () => renderCloudflareWorkerEntry({ ssrStreaming: false, agents: AGENTS })],
  ['bun', () => renderBunEntry(3000)],
  ['deno-deploy', () => renderDenoEntry(3000)],
  ['vercel', () => renderVercelFunctionEntry()],
  ['netlify', () => renderNetlifyFunction()],
  ['aws-lambda', () => renderAwsLambdaEntry()],
] as const

describe('every deploy target carries the agents fragment (B-235)', () => {
  for (const [name, render] of TARGETS) {
    it(`test_${name.replace(/-/g, '_')}_asks_the_aux_dispatcher`, () => {
      expect(
        render(),
        `${name} emits an entry that never calls ${AUX_DISPATCH}, so every agent aux route on it ` +
          `falls through to the run handler and answers BAD_REQUEST for want of a message`,
      ).toContain(AUX_DISPATCH)
    })

    it(`test_${name.replace(/-/g, '_')}_lets_an_agent_card_path_past_the_non_api_guard`, () => {
      // Asking the dispatcher is worth nothing if the request never reaches the branch. Every
      // entry returns early for a path outside `/api/`, and an agent card path is outside it —
      // SI-020, which is why the fragment emits `hostBypass` rather than leaving each host to
      // remember. A target that calls the dispatcher behind a guard that already returned is
      // wired on paper only.
      // Read from the GUARD LINE, not from the file. `.toContain` over the whole entry passed while
      // the guard had dropped the bypass entirely, because the fragment still DECLARES
      // `__theoIsAgentCardPath` further up — so the assertion was satisfied by a declaration nothing
      // used. Measured 2026-09-22 by mutation: deleting `${agentsFragment.hostBypass}` from
      // netlify's guard left all 19 cases green. The comment above was already describing this
      // failure and the assertion was an instance of it.
      const guard = render()
        .split('\n')
        .find((line) => line.includes("startsWith('/api/"))
      expect(guard, `${name} emits no non-API guard at all, so this cannot be judged`).toBeDefined()
      expect(
        guard,
        `${name} calls ${AUX_DISPATCH} but its non-API guard returns first, so the branch is ` +
          `unreachable for exactly the paths it exists to serve`,
      ).toContain('__theoIsAgentCardPath')
    })
  }

  for (const [name, render] of TARGETS) {
    it(`test_${name.replace(/-/g, '_')}_emits_source_that_parses`, () => {
      // Every assertion above is `toContain` over a string, and a string containing the right
      // words can still be a syntax error. These adapters BUILD JavaScript out of template
      // literals; a stray backtick or an unbalanced brace in a fragment ships an entry that
      // cannot load, and no amount of substring matching sees it.
      const source = render()
      // `transpileModule` with `reportDiagnostics` is the PUBLIC way to get syntax errors out of
      // the compiler. `createSourceFile(...).parseDiagnostics` carries the same information and is
      // internal — reaching it needs a cast, and a cast here would hide that the test depends on
      // an API the compiler does not promise.
      const { diagnostics = [] } = ts.transpileModule(source, {
        reportDiagnostics: true,
        fileName: `${name}.js`,
        compilerOptions: {
          allowJs: true,
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
        },
      })
      const first = diagnostics[0]
      const where =
        first === undefined ? '' : ts.flattenDiagnosticMessageText(first.messageText, ' ')
      expect(diagnostics, `${name} emits source that does not parse — ${where}`).toHaveLength(0)
    })
  }

  it('test_the_target_list_is_the_whole_surface', () => {
    // A seventh adapter added without a row here would be silently uncovered, which is the defect
    // B-185 was. Six is asserted so the omission costs a failing test rather than nothing.
    expect(TARGETS).toHaveLength(6)
  })
})
