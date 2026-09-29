/**
 * The fleet invariant behind four separate repairs.
 *
 * The same defect class shipped four times, found once per target, each costing a debug cycle:
 *
 *     cloudflare   #369 / #367        routes and agents baked
 *     vercel       B-319 / B-316      routes baked, entry bundled
 *     netlify      B-338 / B-339      routes and agents baked, entry bundled
 *     aws-lambda   B-344 / B-342      routes and agents baked, entry bundled
 *
 * Every one was the same question asked too late — *after the build, is anything still there?* — and
 * it has two independent halves. Conflating them is why the fix arrived in two pieces on three of the
 * four:
 *
 *     is the project's SOURCE TREE readable at run time?   if not, routes and agents must be BAKED
 *     who makes the BARE SPECIFIERS resolvable?            if nobody, the entry must be BUNDLED
 *
 * Measured across the six entry-emitting adapters on 2026-09-29:
 *
 *     target        reads source   bakes   this adapter bundles
 *     vercel        no             yes     yes
 *     netlify       no             yes     yes
 *     aws-lambda    no             yes     yes
 *     cloudflare    no             yes     no    <- wrangler resolves at deploy time
 *     bun           yes            no      no    <- the project is present
 *     deno-deploy   yes            no      no    <- the project is present, and Deno compiles TS
 *
 * ## Why this is a tested partition and not a belief
 *
 * Four of the six have now been driven at or toward their platform, and **four of four behaved as the
 * partition predicts**: the three that were broken were broken exactly where it says they must bake or
 * bundle and did not, and `vercel` — which does both — came back clean under the strongest local
 * instrument available (`records/acceptance/evidence/b263-vercel-function-driven-locally.txt`).
 *
 * Written in that order deliberately. An earlier draft of this file was abandoned because it would
 * have encoded the author's belief about the partition BEFORE `vercel` was driven; driving it first is
 * what makes these declarations a measurement rather than an opinion.
 *
 * ## What this catches that the other guards cannot
 *
 * `a-generated-entry-declares-every-identifier` catches a name the entry uses and never declares.
 * `every-deploy-target-carries-the-agents-fragment` catches a missing dispatcher. Neither can see a
 * `readdirSync` that will find nothing on a platform, because the entry is CORRECT as text — the
 * defect is a mismatch between what the entry assumes about its environment and where it will run.
 * That mismatch is only checkable against a declaration, which is why the declaration had to exist
 * first.
 *
 * ## What it does NOT establish
 *
 * Nothing about routing, and nothing about a platform executing the artifact. `config.json`'s route
 * table on vercel and the equivalent elsewhere are exercised by a deploy and by nothing here. B-263
 * holds that, with two of six targets still needing a credential.
 */
import { describe, expect, it } from 'vitest'

import {
  awsLambdaAdapter,
  renderAwsLambdaEntry,
} from '../../packages/theo/src/adapters/aws-lambda.js'
import { bunAdapter, renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import {
  cloudflareAdapter,
  renderCloudflareWorkerEntry,
} from '../../packages/theo/src/adapters/cloudflare.js'
import { denoDeployAdapter, renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { netlifyAdapter, renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { VALID_TARGETS, type DeployAdapter } from '../../packages/theo/src/adapters/types.js'
import {
  renderVercelFunctionEntry,
  vercelAdapter,
} from '../../packages/theo/src/adapters/vercel.js'

import { withoutComments as code } from './_helpers/adapter-source.js'

const AGENTS = [
  { filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' },
] as const
const ROUTES = [
  { filePath: 'src/server/routes/health.ts', routePath: '/api/health', methods: ['GET'] },
] as const

/**
 * Routes AND agents are supplied, or the fragments that would scan are never emitted and every
 * assertion below passes over an entry that exercises nothing. The trap
 * `a-generated-entry-declares-every-name-it-uses.test.ts` hit twice.
 */
const FIXTURE = {
  serverDir: 'src/server',
  agentsDir: 'src/server/agents',
  routes: ROUTES,
  agents: AGENTS,
} as const

const FLEET: readonly (readonly [DeployAdapter, string])[] = [
  [vercelAdapter, renderVercelFunctionEntry(FIXTURE)],
  [netlifyAdapter, renderNetlifyFunction(FIXTURE)],
  [awsLambdaAdapter, renderAwsLambdaEntry(FIXTURE)],
  [cloudflareAdapter, renderCloudflareWorkerEntry({ ...FIXTURE, ssrStreaming: false })],
  [bunAdapter, renderBunEntry(3000, FIXTURE)],
  [denoDeployAdapter, renderDenoEntry(3000, FIXTURE)],
]

/** Targets that emit no entry for this check to read, each with the reason. */
const NO_GENERATED_ENTRY: readonly string[] = [
  'node', // runs from the project directory against real source; emits no entry string
  'static', // emits assets and no server entry at all
  'theo-cloud', // ships no adapter in this repository yet
]

/** The calls that read the project's source tree while serving a request. */
const RUNTIME_SCANS = ['scanServerRoutes(', 'scanAgents('] as const

describe('a deployed entry is self-contained where it must be', () => {
  it('classifies every build target, derived from VALID_TARGETS', () => {
    const covered = new Set([...FLEET.map(([a]) => a.name), ...NO_GENERATED_ENTRY])

    expect(
      VALID_TARGETS.filter((t) => !covered.has(t)),
      'these targets are in neither list, so nothing says whether their entry must be ' +
        'self-contained. Add the adapter to FLEET, or the target to NO_GENERATED_ENTRY with the ' +
        'reason — two lists is how a new adapter gets added to neither, because the excluding list ' +
        'is the one that costs nothing',
    ).toEqual([])
  })

  it('has targets on both sides, so no assertion below is vacuous', () => {
    // COUNTERPROOF FIRST. Every check here is conditional on a declaration, so a fleet declaring one
    // value everywhere would satisfy all of them while proving nothing.
    expect(FLEET.filter(([a]) => a.readsSourceAtRunTime === true).map(([a]) => a.name)).toEqual([
      'bun',
      'deno-deploy',
    ])
    expect(FLEET.filter(([a]) => a.readsSourceAtRunTime === false).length).toBe(4)
    expect(FLEET.filter(([a]) => a.specifiersResolvedBy === 'this-adapter').length).toBe(3)
  })

  it.each(FLEET.map(([adapter]) => ({ name: adapter.name, adapter })))(
    '$name declares both halves',
    ({ adapter }) => {
      // Undeclared is where a NEW adapter starts, and it must read as neither answer. `types.ts`
      // records why: `enforcesRateLimit`'s first cut defaulted to the permissive value and inverted
      // the rule it replaced.
      expect(
        adapter.readsSourceAtRunTime,
        'undeclared. A deployed entry either can read the project at run time or cannot, and the ' +
          'answer decides whether its routes and agents must be baked',
      ).toBeTypeOf('boolean')
      expect(
        adapter.specifiersResolvedBy,
        'undeclared. Somebody has to make `theokit/server/scan` resolvable, and where nobody does ' +
          'the entry fails at import rather than at request time',
      ).toBeDefined()
    },
  )

  it.each(
    FLEET.filter(([a]) => a.readsSourceAtRunTime === false).map(([adapter, entry]) => ({
      name: adapter.name,
      entry,
    })),
  )('$name bakes, because it cannot read the project at run time', ({ name, entry }) => {
    const body = code(entry)

    expect(
      RUNTIME_SCANS.filter((call) => body.includes(call)),
      `${name} declares it cannot read the project's source tree at run time, and its entry calls ` +
        'these anyway. Each is a readdirSync that finds nothing where the artifact was uploaded ' +
        'alone — the 404 measured on netlify and aws-lambda — or finds TypeScript a plain runtime ' +
        'cannot compile',
    ).toEqual([])
  })

  it.each(
    FLEET.filter(([a]) => a.specifiersResolvedBy === 'this-adapter').map(([adapter]) => ({
      name: adapter.name,
    })),
  )('$name reaches the bundler, because nothing else resolves its imports', async ({ name }) => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      new URL(`../../packages/theo/src/adapters/${name}.ts`, import.meta.url),
      'utf-8',
    )

    expect(
      source.includes('bundleDeployedFunction'),
      `${name} declares that IT makes the specifiers resolvable and never calls the bundler. The ` +
        "entry then ships as source, and `ERR_MODULE_NOT_FOUND: Cannot find package 'theokit'` is " +
        'what the platform answers — measured on all three targets that declare this',
    ).toBe(true)
  })
})
