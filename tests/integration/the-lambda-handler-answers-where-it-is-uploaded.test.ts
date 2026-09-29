/**
 * The bundled Lambda handler answers a request from a directory with no `node_modules`.
 *
 * This is the exercise `docs/adr/0020` said this target was missing. That ADR named `netlify` and
 * `aws-lambda` as the two it did not change, "because neither has been exercised against its platform
 * and a fix nobody can verify is a claim rather than a repair" — and then changed `vercel` on the
 * strength of a weaker local property, "the directory loads standalone under node", with no Vercel
 * deployment either.
 *
 * A Lambda handler needs no emulator. It is a function taking an event, so loading it standalone AND
 * CALLING IT is available locally, and that is strictly more than the property the ADR accepted.
 *
 * Measured on 2026-09-29, in this order, each failure naming the next cause:
 *
 *     the entry as written, copied to a directory with no node_modules
 *       -> ERR_MODULE_NOT_FOUND: Cannot find package 'theokit'
 *     bundled, same directory
 *       -> loads; invoked with GET /api/health it answered 404 {"error":{"code":"NOT_FOUND"}}
 *          because `scanServerRoutes` is a readdirSync and an upload carries no source tree
 *     bundled AND routes baked
 *       -> 200 {"status":"ok",...,"framework":"TheoKit"} with x-request-id echoed
 *
 * What is still NOT established: that AWS invokes it. That needs a deployment, and B-263 holds the
 * credential as a retained `access` impediment under `rules/decision-delegation.txt`.
 *
 * ## The fixture, and why it is shaped like this
 *
 * `project/` carries `node_modules/theokit` as a SYMLINK to this repository's package, which is what a
 * consumer has and what the bundle needs in order to inline anything. `out/` is a sibling OUTSIDE it,
 * so Node's parent-directory lookup cannot find that symlink at load time — the same separation
 * `a-bundled-function-loads-without-node-modules.test.ts` relies on, and for the same reason: if
 * `out/` sat inside `project/`, an entry whose imports were never inlined would load anyway and this
 * file would pass over the defect it exists to catch.
 *
 * It drives `buildAwsLambda` — the PRODUCTION caller — with only the client build stubbed. The
 * distinction is the whole point: `renderAwsLambdaEntry` accepting `routes` proves nothing if no build
 * passes them, which is the blind spot B-235, B-312 and B-315 each paid for once.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildAwsLambda } from '../../packages/theo/src/adapters/aws-lambda.js'

const REPO = resolve(import.meta.dirname, '../..')

/** A GET /api/health event in the shape API Gateway HTTP API v2 sends. */
const EVENT = {
  version: '2.0',
  routeKey: 'GET /api/health',
  rawPath: '/api/health',
  rawQueryString: '',
  headers: { host: 'x.example', 'x-forwarded-proto': 'https' },
  requestContext: {
    http: { method: 'GET', path: '/api/health', sourceIp: '1.2.3.4' },
    domainName: 'x.example',
  },
  isBase64Encoded: false,
}

let root = ''
let project = ''
let out = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-lambda-'))
  project = join(root, 'project')
  out = join(root, 'out')
  mkdirSync(join(project, 'src/server/routes'), { recursive: true })
  mkdirSync(join(project, 'node_modules'), { recursive: true })
  mkdirSync(out, { recursive: true })

  // What a consumer has. Without it the bundler cannot resolve `theokit/…` and there is nothing to
  // inline — the bundle would fail rather than produce an unresolvable entry, which is a different
  // failure from the one under test.
  symlinkSync(resolve(REPO, 'packages/theo'), join(project, 'node_modules/theokit'))
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }))
  writeFileSync(
    join(project, 'src/server/routes/health.ts'),
    `export const GET = () => Response.json({ status: 'ok', framework: 'TheoKit' })\n`,
  )
  // An agent, because the branch that serves one is a DIFFERENT branch of `routeRequest` and the
  // case below is the only thing in this repository that enters it.
  mkdirSync(join(project, 'src/server/agents'), { recursive: true })
  writeFileSync(
    join(project, 'src/server/agents/chat.ts'),
    `export default { name: 'chat', model: 'openai/gpt-4o-mini', instructions: 'be brief' }\n`,
  )

  // `out/` must look like ESM on its own, the way an uploaded directory does.
  writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'module' }))
})

afterAll(() => {
  if (root !== '' && existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('the Lambda handler answers where it is uploaded', () => {
  it('loads and answers 200 from a directory with no node_modules', async () => {
    await buildAwsLambda(
      {
        serverDir: 'src/server',
        agentsDir: 'src/server/agents',
        appDir: 'src/app',
        distDir: '.theokit',
        ssr: false,
        ssrStreaming: false,
        security: {},
      } as never,
      project,
      { runNodeBuild: async () => {} },
      {
        scanRoutes: () => ({
          routes: [
            {
              filePath: 'src/server/routes/health.ts',
              routePath: '/api/health',
              methods: ['GET'],
            },
          ],
          agents: [],
        }),
      } as never,
    )

    // The "upload": the directory, and nothing else.
    cpSync(join(project, '.theokit/aws'), out, { recursive: true })
    writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'module' }))

    const mod: Record<string, unknown> = await import(pathToFileURL(join(out, 'handler.mjs')).href)
    const handler = (mod.handler ?? mod.default) as (
      e: unknown,
      c: unknown,
    ) => Promise<{
      statusCode?: number
      body?: string
      headers?: Record<string, string>
    }>

    expect(
      typeof handler,
      'the handler did not load standalone, which is what ERR_MODULE_NOT_FOUND looked like before ' +
        'the entry was bundled',
    ).toBe('function')

    const res = await handler(EVENT, { awsRequestId: 'test-1' })

    expect(
      res.statusCode,
      'a 404 here means the routes were not baked: the entry fell back to a readdirSync over a ' +
        'source tree the upload does not carry',
    ).toBe(200)
    expect(String(res.body)).toContain('"framework":"TheoKit"')
    expect(
      res.headers?.['x-request-id'] ?? res.headers?.['x-trace-id'],
      "the trace header is the evidence that theokit's own pipeline ran, not just that something " +
        'returned 200',
    ).toBeTruthy()
  }, 120_000)

  it('answers an agent route without a ReferenceError', async () => {
    // The branch the case above never enters. `agents: []` there means the agents fragment is emitted
    // and never reached, so a free identifier inside it costs nothing locally and a 502 on the
    // platform — which is exactly what happened.
    //
    // Measured 2026-09-29 on a real deployed Function URL: `/api/health` answered 200 while
    // `/api/agents/chat` answered 502, CloudWatch naming `ReferenceError: url is not defined at
    // routeRequest`. The fragment read `url.origin`, an unwritten contract that the host declares a
    // `URL` named `url` in the scope the fragment lands in; this entry builds a STRING, in another
    // function. Reproduced locally at the SAME line and function as production once an agent was in
    // the scan.
    //
    // What is asserted is the absence of a 5xx, not a 200: without a provider credential the agent's
    // own validation answers 4xx, and demanding a 200 would make this case depend on a key. A 4xx
    // from the agent IS the proof the branch ran — a ReferenceError never reaches it.
    const agentOut = join(root, 'out-agent')
    mkdirSync(agentOut, { recursive: true })

    await buildAwsLambda(
      {
        serverDir: 'src/server',
        agentsDir: 'src/server/agents',
        appDir: 'src/app',
        distDir: '.theokit',
        ssr: false,
        ssrStreaming: false,
        security: {},
      } as never,
      project,
      { runNodeBuild: async () => {} },
      {
        scanRoutes: () => ({
          routes: [
            {
              filePath: 'src/server/routes/health.ts',
              routePath: '/api/health',
              methods: ['GET'],
            },
          ],
          agents: [
            {
              filePath: 'src/server/agents/chat.ts',
              agentPath: '/api/agents/chat',
              name: 'chat',
            },
          ],
        }),
      } as never,
    )

    cpSync(join(project, '.theokit/aws'), agentOut, { recursive: true })
    writeFileSync(join(agentOut, 'package.json'), JSON.stringify({ type: 'module' }))

    const mod: Record<string, unknown> = await import(
      pathToFileURL(join(agentOut, 'handler.mjs')).href
    )
    const handler = (mod.handler ?? mod.default) as (
      e: unknown,
      c: unknown,
    ) => Promise<{ statusCode?: number; body?: string }>

    const res = await handler(
      {
        version: '2.0',
        routeKey: 'POST /api/agents/chat',
        rawPath: '/api/agents/chat',
        rawQueryString: '',
        // `x-theo-action` and a matching Origin, or the CSRF guard answers 403 BEFORE the agent
        // branch runs and this case proves nothing about the line that threw.
        headers: {
          host: 'x.example',
          'x-forwarded-proto': 'https',
          'content-type': 'application/json',
          'x-theo-action': '1',
          origin: 'https://x.example',
        },
        requestContext: {
          http: { method: 'POST', path: '/api/agents/chat', sourceIp: '1.2.3.4' },
          domainName: 'x.example',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
        isBase64Encoded: false,
      },
      { awsRequestId: 'test-agent' },
    )

    expect(
      res.statusCode,
      `the agent branch threw instead of answering. Before the fix this was a ReferenceError on ` +
        `\`url\` at routeRequest, identical to the one a deployed Function URL produced. Body: ` +
        (res.body ?? '').slice(0, 200),
    ).toBeLessThan(500)
  })

  it('proves the isolation it depends on', async () => {
    // COUNTERPROOF, and it is load-bearing. If `out/` could see the project's node_modules, an entry
    // whose imports were never inlined would load anyway and the case above would pass over the
    // defect. So an UNBUNDLED entry placed there must fail.
    const raw = join(out, 'raw.mjs')
    writeFileSync(
      raw,
      `import { matchRoute } from 'theokit/server/scan'\nexport const handler = () => matchRoute\n`,
    )

    await expect(import(pathToFileURL(raw).href)).rejects.toThrow(/Cannot find package 'theokit'/u)
  })
})
