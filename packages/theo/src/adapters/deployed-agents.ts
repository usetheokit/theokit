/**
 * Serving an agent from a generated deploy entry (usetheokit/theokit#367).
 *
 * ## The gap this closes
 *
 * `grep -rc "agent" packages/theo/src/adapters/*.ts` used to return nothing across 14 files. The
 * notion did not exist in this layer at all: every generated entry routes `/api/` exclusively
 * through `scanServerRoutes` + `executeRoute`, and an agent is a DIFFERENT scan served by a
 * DIFFERENT function — `scanAgents` + `mountAgent`. So `/api/agents/chat` matched no file route and
 * fell into `notFoundResponse()` on every target.
 *
 * For a framework whose stated reason to exist is "the agent is a file, delivered by the same
 * pipeline that serves the page", that is the gap which contradicts the sentence: the agent was
 * delivered by no pipeline at all outside a machine running `theokit start`.
 *
 * ## Why baking, and why `../../`
 *
 * A Worker has no filesystem to scan and no path to `import()`, which is the same reason routes are
 * baked (#369). The agent modules are resolved on the build machine and emitted as static imports,
 * relative to the entry's directory — every target that can do this writes two levels below the
 * project root, so the arithmetic is the one `renderBakedRoutes` already does.
 *
 * ## Which targets can do it
 *
 * Only the ones whose output is BUNDLED from the project: `cloudflare` (wrangler), `bun` and
 * `deno-deploy` resolve the emitted import against the app's own source tree. `vercel`, `netlify`
 * and `aws-lambda` receive a standalone function directory that never sees the app's modules, so
 * an agent cannot travel there by this road at all. Same split as plugins (#425), same cause.
 *
 * ## The table is keyed by NAME
 *
 * The URL carries the name, the access policy is judged under the name, and the run's spans are
 * labelled with it (#406). Keying by file path would make the lookup depend on the server's
 * directory layout — which changes per deploy, and which is exactly the value #406 removed from
 * telemetry for the same reason.
 */

/** One agent, as `scanAgents` reports it. Structural, so the adapters need no `server/` import. */
export interface DeployedAgent {
  /** Path relative to the project root — the specifier the static import uses. */
  readonly filePath: string
  /** The URL the agent answers on. */
  readonly agentPath: string
  /** The agent's NAME — what the URL carries, the policy is judged under, and spans are labelled. */
  readonly name: string
}

export interface DeployedAgentsFragment {
  /** Top-level imports of the agent modules. */
  readonly imports: string[]
  /** Module-scope declarations — the name→module table. */
  readonly declarations: string[]
  /** The request-handler branch, to be emitted before the file-route table is consulted. */
  readonly branch: string[]
  /**
   * SI-020 — the condition a host ANDs into its non-API early-return guard, so an agent card path
   * is not handed to static assets before this fragment's branch is reached.
   *
   * Empty string when the fragment emits nothing, so a host that interpolates it unconditionally
   * never references a name that was not declared.
   */
  readonly hostBypass: string
}

const EMPTY: DeployedAgentsFragment = { imports: [], declarations: [], branch: [], hostBypass: '' }

/**
 * How the host entry names the things this branch has to use.
 *
 * The fragment is generated code injected into three entries that do NOT agree on their own
 * vocabulary — Bun reads `pathname`, Cloudflare reads `url.pathname`; Deno calls `notFound()`,
 * Cloudflare calls `notFoundResponse()`; Cloudflare wraps each branch in the security baseline
 * while Bun and Deno wrap once at the caller; Deno resolves npm packages with an `npm:` prefix.
 *
 * Naming those differences is what keeps this ONE fragment. The alternative — three near-identical
 * branches, one per adapter — is the copy that `serveThroughPluginLifecycle` was extracted to undo
 * after it had drifted five ways (#405).
 */
/**
 * How the target REACHES its agent modules — and the two answers are genuinely different, not a
 * copy waiting to be merged.
 *
 * A Worker has no filesystem: its agents must be resolved on the build machine and emitted as
 * static imports, which is what `renderBakedRoutes` already does for routes there. Bun and Deno DO
 * have a filesystem and already scan their routes at request time; making them bake would couple an
 * agent's existence to a rebuild for no gain. The split mirrors the one routes already have on
 * exactly these targets, which is the argument for keeping it.
 */
export type DeployedAgentsSource =
  | {
      readonly kind: 'baked'
      /** Scanned on the build machine, emitted as static imports. */
      readonly agents: readonly DeployedAgent[]
      /**
       * B-185 — the app's `server/context.ts`, as a specifier relative to the emitted entry, or
       * `undefined` when the app has none. A Worker has no filesystem on which to find it, so it is
       * baked like the agent modules beside it (ADR 0014). `undefined` is the ordinary case for an
       * app that declares no context, and emitting an import of a file that is not there would
       * fail the BUILD rather than the request — which is why `planDeployedPlugins` takes the same
       * road for plugins.
       */
      readonly contextModule?: string
    }
  | {
      readonly kind: 'scan'
      /** Expression yielding the project root at runtime. */
      readonly projectRoot: string
      /** Expression yielding the module loader the entry already builds. */
      readonly loadModule: string
      /**
       * A statement that guarantees `loadModule` is usable, for a host that builds its loader
       * lazily. Deno's `loaderCache` is created on the route path, which runs AFTER this branch —
       * so without this the agent branch would call `null`.
       */
      readonly ensureLoader?: string
      /** The configured agents directory as a quoted literal. Absent ⇒ `scanAgents` defaults to `agents`. */
      readonly agentsDirLiteral?: string
      /**
       * B-185 — an expression yielding the app's `server/` directory, which this host already
       * declares (`bun.ts:95`, `deno-deploy.ts:69`) and already hands to `executeRoute`. A host
       * with a filesystem locates its own `context.ts`, so it needs no baking (ADR 0014, and the
       * split `deployed-agents.ts` already argues for routes two docblocks above).
       */
      readonly serverDir?: string
    }

export interface DeployedAgentsHost {
  /** Expression yielding the request path inside the handler. Default `url.pathname`. */
  readonly pathname?: string
  /** Call producing the 404 response. Default `notFoundResponse()`. */
  readonly notFound?: string
  /** Whether THIS branch applies the security baseline, or the caller already does. */
  readonly wrapSecurityHeaders?: boolean
  /** Prefix for bare package specifiers. Deno needs `npm:`; the others need nothing. */
  readonly importPrefix?: string
  /**
   * Expression yielding the entry's plugin runner, or `undefined` when the app declared no plugins
   * and the build emitted no module to bind.
   *
   * `deployedRuntimeConfigFragment` already declares `const THEO_PLUGIN_RUNNER` at module scope and
   * spreads `pluginRunner: await THEO_PLUGIN_RUNNER` into `executeRoute`; an adapter passes that
   * same expression here rather than building a second runner, because a runner rebuilt per request
   * re-runs every plugin's `register` -- which is where a plugin allocates the state its hooks read.
   */
  readonly pluginRunnerExpr?: string
}

/**
 * The two `AuxRouteDeps` fields a deployed entry must supply to match what dev already does.
 *
 * Both dev callers pass them — `vite-plugin/agent-middleware.ts:161,164` and
 * `cli/commands/start/handlers.ts:226,229` — and a first draft of this fragment passed neither,
 * on a quotation from `serve-aux-routes.ts:83-85` that names three routes ("card, approvals,
 * stream") while the dispatcher serves six. Two reviewers measured the same two consequences:
 *
 * - `csrfMode` unset defaults to `'strict'` (`serve-aux-routes.ts:379`), so an app declaring
 *   `security: { csrf: 'off' }` got `off` on `POST /api/agents/<name>` and `strict` on its `/mcp`
 *   sibling one line away — verbatim the divergence `deployed-csrf.ts`'s own header exists to
 *   record, re-created on a route this slice had just made reachable.
 * - `resolveApiKey` unset makes the thread follow-up answer a permanent 501 on every deploy
 *   target (`serve-aux-routes.ts:359-365`), naming a framework-internal parameter to the caller.
 *
 * Both values are already in scope: `CSRF_CONFIG` is spread into `mountAgent` in the same emitted
 * function, and `resolveProvider` is already on its import line.
 */
const AUX_DEPS_PARITY = [
  `        ...CSRF_CONFIG,`,
  `        resolveApiKey: (model, plugins) => resolveProvider(model, { plugins }).apiKey,`,
] as const

/** The prefix the agent convention owns. Matches `handlers.ts`'s own `tryServeAgent`. */
const AGENT_PREFIX = '/api/agents/'

/**
 * The second shape the aux dispatcher owns. `matchGetAuxRoute` serves M15's
 * `GET /.well-known/<name>/agent-card.json`, and a guard admitting only {@link AGENT_PREFIX} left
 * five of the dispatcher's six families reachable on a deploy target and excluded the sixth — by
 * the guard, not by a decision, and silently.
 *
 * A prefix rather than the matcher's own `isAgentCardPath`: the guard exists to keep a url nobody
 * answers from paying for anything, and importing the matcher's predicate into every emitted entry
 * would buy a narrower pre-filter at the cost of a module the branch already declines without.
 */
const WELL_KNOWN_PREFIX = '/.well-known/'

/**
 * What a deployed entry needs in order to serve the app's agents.
 *
 * @param agents - the agents scanned on the build machine. Empty emits nothing at all.
 */
export function deployedAgentsFragment(
  source: DeployedAgentsSource | undefined,
  host: DeployedAgentsHost = {},
): DeployedAgentsFragment {
  if (source === undefined) return EMPTY
  if (source.kind === 'baked' && source.agents.length === 0) return EMPTY

  const pathname = host.pathname ?? 'url.pathname'
  const notFound = host.notFound ?? 'notFoundResponse()'
  const prefix = host.importPrefix ?? ''

  const resolution =
    source.kind === 'baked'
      ? bakedResolution(source.agents, source.contextModule, host.pluginRunnerExpr)
      : scannedResolution({ ...source, pluginRunnerExpr: host.pluginRunnerExpr })

  return {
    hostBypass: ` && !__theoIsAgentCardPath(${pathname})`,
    imports: [
      // `theokit/adapters/agent-mount`, not `theokit/server`: `mount-agent` is deliberately not on
      // the app-facing surface (ADR 0041), and a generated entry is not an app. See that module.
      // B-185 — the identity entry differs by host: a filesystem host LOCATES its own
      // `context.ts`, a Worker is handed the baked factory (ADR 0014). `createWebShim` is not here
      // because all three entries already import it at module level.
      `import { mountAgent, resolveProvider, matchAgentAuxRoute, serveMatchedAuxRoute${resolution.identityImport}${source.kind === 'scan' ? ', scanAgents' : ''} } from '${prefix}theokit/adapters/agent-mount'`,
      ...resolution.imports,
    ],
    declarations: [
      ...resolution.declarations,
      // SI-020 — the host's `/api/` guard decides between the API surface and static assets, and it
      // runs BEFORE this branch. Widening the branch guard alone left the `.well-known` arm as dead
      // code on all three targets: present in the source, unreachable in the emitted program. The
      // host consults this predicate, so the card path escapes the asset branch and NOTHING else
      // under `/.well-known/` does — a blanket prefix bypass would route `/.well-known/security.txt`
      // away from assets, trading an unreachable card for a broken namespace.
      //
      // Same shape as `agent-card-handler.ts`'s own WELL_KNOWN. That is a COPY, not a shared
      // definition, and saying otherwise was the claim an inventory judge falsified: changing the
      // handler to serve `/agent.json` left every card test green, because this guard and that
      // matcher are checked separately and never against each other. The drift that matters here —
      // this guard narrowing while the matcher still serves the path — is caught by
      // `a-deployed-worker-reaches-the-agent-card.test.ts`, which drives a real request. The other
      // direction is not, and is the honest limit of this line.
      String.raw`const __theoIsAgentCardPath = (p) => /^\/\.well-known\/[^/]+\/agent-card\.json$/.test(p)`,
      // B-185 — one factory, two call sites: the aux branch on a hit, and the run handler below.
      // Declared rather than inlined twice so the mechanism ADR 0014 decides has a single home.
      // `async` because the entry's plugin runner is a promise: `createPluginRunnerFromConfig` is
      // async, so the runtime-config fragment declares `const THEO_PLUGIN_RUNNER = createPluginRunnerFromConfig(...)`
      // WITHOUT awaiting it, and every consumer awaits at the point of use. `await` is a reserved
      // word everywhere in an ES module, so a non-async factory carrying that binding does not
      // merely misbehave -- the entry does not parse, and `tests/unit/adapter-entry-parses.test.ts`
      // is where that is caught. It went red at HEAD before this line existed, on a first version
      // of this fix whose own test asserted `toContain('await THEO_PLUGIN_RUNNER')`: the presence
      // of the token that breaks the parse. That test file's header says why, in its own words --
      // `toContain` does not care whether the string is a program.
      //
      // Laziness is unaffected. The shim was always built eagerly inside this factory; what ADR-1
      // refuses is paying for a url nobody answers, and neither call site is reached by one.
      `async function __theoResolveSubject(request) {`,
      ...resolution.identity,
      `  return resolveSubject`,
      `}`,
    ],
    branch: [
      `    // #367 — the agent convention owns this prefix. It is answered BEFORE the file-route`,
      `    // table because an agent matches no file route: falling through is how a deployed`,
      `    // \`/api/agents/<name>\` used to 404 on every target.`,
      `    if (`,
      `      ${pathname}.startsWith(${JSON.stringify(AGENT_PREFIX)}) ||`,
      `      ${pathname}.startsWith(${JSON.stringify(WELL_KNOWN_PREFIX)})`,
      `    ) {`,
      ...resolution.auxPrelude,
      `      // B-185 — the aux dispatcher is asked FIRST, and declining costs nothing: the matcher`,
      `      // reads the url and the scanned nodes, never a module (ADR-1). A miss falls through to`,
      `      // the run handler exactly as before, so this branch owns the sub-paths and nothing more.`,
      `      const auxRoute = await matchAgentAuxRoute(request.method, ${pathname}, auxDeps)`,
      `      if (auxRoute !== null) {`,
      `        // B-185 — identity is resolved only now. Building it costs a web shim and, where the`,
      `        // app declares one, a call into its own \`createContext\`; a url this dispatcher`,
      `        // merely declined must pay for neither (resolve-agent-subject.ts:93-96).`,
      `        const auxResponse = await serveMatchedAuxRoute(auxRoute, request, {`,
      `          ...auxDeps,`,
      `          resolveSubject: await __theoResolveSubject(request),`,
      `        })`,
      host.wrapSecurityHeaders === true
        ? `        return withSecurityHeaders(auxResponse, SECURITY_HEADERS)`
        : `        return auxResponse`,
      `      }`,
      `      // B-185 — only the agent prefix has a run handler behind it. A \`.well-known\` url the`,
      `      // dispatcher declined must NOT slice a prefix it does not carry: the name would be`,
      `      // garbage and mountAgent would answer 500 for what is a routing miss.`,
      `      if (!${pathname}.startsWith(${JSON.stringify(AGENT_PREFIX)})) return ${notFound}`,
      `      const agentName = ${pathname}.slice(${String(AGENT_PREFIX.length)}).split('/')[0]`,
      ...resolution.lookup,
      `      // A name nobody scanned is a 404, exactly like any other unknown path. Handing`,
      `      // \`undefined\` to mountAgent would surface as a 500 for what is a routing miss.`,
      `      if (mod === undefined) return ${notFound}`,
      `      const agentResponse = await mountAgent(mod, request, (model, plugins) => resolveProvider(model, { plugins }).apiKey, {`,
      `        agentName,`,
      `        // B-185 — mount-agent.ts:121 has accepted this since #365 and 0 of 23 adapters passed`,
      `        // one, so agent-access.ts:146 judged every deployed policy against \`subject: null\`.`,
      `        // A run is not a decline: it is about to do real work, so the shim this builds is not`,
      `        // the cost ADR-1 refuses.`,
      `        resolveSubject: await __theoResolveSubject(request),`,
      `        ...CSRF_CONFIG,`,
      `      })`,
      host.wrapSecurityHeaders === true
        ? `      return withSecurityHeaders(agentResponse, SECURITY_HEADERS)`
        : `      return agentResponse`,
      `    }`,
    ],
  }
}

interface AgentResolution {
  imports: string[]
  declarations: string[]
  /** Lines that must leave `mod` bound to the agent's module, or `undefined`. */
  lookup: string[]
  /**
   * B-185 — lines that must leave `auxDeps` bound to an `AuxRouteDeps`, plus the expression for
   * its `agents`. They run BEFORE {@link AgentResolution.lookup} so a declined aux route performs
   * no module load, which is what ADR-1 buys and what a later ordering would spend.
   */
  auxPrelude: string[]
  /**
   * B-185 — lines that must leave `resolveSubject` bound to a resolver, or to `undefined`. Emitted
   * only where a match has already happened, because building one costs a web shim and
   * `resolve-agent-subject.ts:93-96` states that a declined url must never run the application's
   * `createContext`.
   */
  identity: string[]
  /**
   * B-185 — what {@link AgentResolution.identity} imports, appended to the `agent-mount` line, or
   * `''` where identity is not resolved at all.
   *
   * It lives HERE, beside the lines that CALL it, because a first draft decided it in a separate
   * `identityEntryFor` that switched the same discriminated union a second time. The two could not
   * disagree then — the conditions were identical — which is what made it latent rather than live.
   * A later drift would emit an entry that CALLS a symbol it never imported, and nothing catches
   * that: the stub-coverage guard derives its requirement FROM the imports, so a missing import
   * shrinks the requirement instead of failing, and `node --check` is syntax rather than
   * resolution. It would surface as a `ReferenceError` inside a deployed Worker.
   */
  identityImport: string
}

/** No filesystem: every agent module is a static import decided on the build machine. */
function bakedResolution(
  agents: readonly DeployedAgent[],
  contextModule: string | undefined,
  pluginRunnerExpr: string | undefined,
): AgentResolution {
  const varOf = (index: number): string => `__theoAgent${String(index)}`
  return {
    imports: [
      ...agents.map((agent, index) => `import * as ${varOf(index)} from '../../${agent.filePath}'`),
      // B-185 — the app's context module, baked exactly like the agents above it (ADR 0014).
      ...(contextModule === undefined
        ? []
        : [
            // SI-022 — DYNAMIC, not a top-level static import. B-185 added this import; before it
            // a Worker did not load the app's `server/context.ts` at all. A module-scope throw
            // there — the commonest shape being a required-env-var check — then went from costing
            // nothing to taking the ENTIRE target down: the import fails, the module never
            // evaluates, and every route dies rather than only the one that wanted an identity.
            //
            // That is strictly worse than what `resolve-agent-subject.ts:69-72` promises. It says
            // a throwing `createContext` reaches the branch's own error handler and becomes a 500,
            // which is a failure scoped to the request that needed identity. A throw at IMPORT
            // time reaches no handler at all.
            //
            // A relative `import()` is statically analysable, so wrangler bundles the module
            // exactly as it bundled the static form — the reason ADR 0014 bakes it is unaffected.
            // What changes is WHEN it evaluates, and therefore what a failure costs. It is only
            // a real improvement if the import stays inside the thunk; see the factory below.
            `const __theoContext = () => import('../../${contextModule}')`,
          ]),
    ],
    declarations: [
      `// #367 — the app's agents, keyed by NAME because that is what the URL carries, what the`,
      `// access policy is judged under, and what the run's spans are labelled with (#406).`,
      `const agents = {`,
      ...agents.map((agent, index) => `  ${JSON.stringify(agent.name)}: ${varOf(index)},`),
      `}`,
      `// B-185 — the node list the aux dispatcher matches a url against. There is deliberately NO`,
      `// second table keyed by file path: \`test_the_table_is_keyed_by_agent_name_not_by_file_path\``,
      `// forbids one, and the reason it gives is the right one — a path key makes a lookup depend on`,
      `// the server's directory layout. The loader below reaches the module THROUGH this list, so the`,
      `// layout appears once, here, and the module table above stays keyed by the name the URL, the`,
      `// access policy and the run's spans all carry (#406).`,
      `const agentNodes = [`,
      ...agents.map(
        (agent) =>
          `  { filePath: ${JSON.stringify(agent.filePath)}, agentPath: ${JSON.stringify(agent.agentPath)}, name: ${JSON.stringify(agent.name)} },`,
      ),
      `]`,
    ],
    lookup: [
      `      const mod = Object.prototype.hasOwnProperty.call(agents, agentName)`,
      `        ? agents[agentName]`,
      `        : undefined`,
    ],
    identityImport: contextModule === undefined ? '' : ', createSubjectResolverFromFactory',
    identity:
      contextModule === undefined
        ? [
            `  // B-185 — this app declares no \`server/context.ts\`, so there is no factory to`,
            `  // bake and an anonymous caller is the honest answer. A policy that admits`,
            `  // nobody is the correct outcome, not an error.`,
            `        const resolveSubject = undefined`,
          ]
        : [
            `  // B-185 — a Worker has no filesystem to find \`context.ts\` on, so the module is baked`,
            `  // and its factory handed straight to the resolver (ADR 0014).`,
            `  //`,
            `  // This function has TWO callers and is lazy on purpose. Both build a shim, and that is`,
            `  // correct at both: the aux branch calls it only AFTER a match, and the run handler is`,
            `  // about to do real work. What neither pays for is the app's own \`createContext\` on a`,
            `  // url nobody answers — the resolver is a thunk, and \`agent-access.ts:146\` returns early`,
            `  // for an absent or public policy without ever invoking it.`,
            `        const { req: __theoReq, res: __theoRes } = createWebShim(request)`,
            `  const resolveSubject = createSubjectResolverFromFactory(`,
            // The import happens HERE, inside the factory, and `createSubjectResolverFromFactory`
            // calls the factory inside the thunk it returns (`resolve-agent-subject.ts:127-133`).
            // A first version of this fix awaited the import as an ARGUMENT, which evaluated it
            // eagerly inside `__theoResolveSubject` — both call sites await that before
            // `agent-access.ts:145` returns early for an absent or `'public'` policy. The blast
            // radius was then every agent request rather than the one that wanted an identity,
            // and the laziness invariant the lines above assert was broken. Found by the
            // inventory judge while the change was still in the working tree.
            `    async (__theoArgs) => (await __theoContext()).createContext(__theoArgs),`,
            `    __theoReq,`,
            `    __theoRes,`,
            `    ${pluginRunnerExpr ?? 'undefined'},`,
            `  )`,
          ],
    auxPrelude: [
      `      // B-185 — the aux dispatcher needs nodes carrying \`filePath\` and a loader keyed by it.`,
      `      // The loader resolves the path to a NAME through the node list, then reads the same`,
      `      // name-keyed table the url lookup uses: one map, one layout mention, no filesystem`,
      `      // (ADR-2). A linear find over a handful of agents is not worth a second table that`,
      `      // \`test_the_table_is_keyed_by_agent_name_not_by_file_path\` exists to forbid.`,
      `      const auxDeps = {`,
      `        agents: agentNodes,`,
      `        loadModule: async (filePath) => {`,
      `          const node = agentNodes.find((a) => a.filePath === filePath)`,
      `          return node === undefined ? undefined : agents[node.name]`,
      `        },`,
      `        baseUrl: url.origin,`,
      ...AUX_DEPS_PARITY,
      `      }`,
    ],
  }
}

/** A filesystem: scan once and load on demand, exactly as this entry already treats its routes. */
function scannedResolution(source: {
  projectRoot: string
  loadModule: string
  ensureLoader?: string
  agentsDirLiteral?: string
  serverDir?: string
  pluginRunnerExpr?: string
}): AgentResolution {
  // The configured directory as a second argument, or nothing. `scanAgents` defaults the name to
  // `agents`, which is right for a project that never set one and wrong for every project that did.
  const agentsDirArg = source.agentsDirLiteral === undefined ? '' : `, ${source.agentsDirLiteral}`

  return {
    imports: [],
    declarations: [
      `// #367 — scanned on first use and cached, the same shape this entry already gives routes.`,
      `// Baking would tie an agent's existence to a rebuild on a target that has a filesystem.`,
      `let agentsCache = null`,
    ],
    lookup: [
      `      const agentNode = agentsCache.find((a) => a.name === agentName)`,
      `      const mod = agentNode === undefined ? undefined : await ${source.loadModule}(agentNode.filePath)`,
    ],
    identityImport: source.serverDir === undefined ? '' : ', createAgentSubjectResolver',
    identity:
      source.serverDir === undefined
        ? [`        const resolveSubject = undefined`]
        : [
            `  // B-185 — this host HAS a filesystem, so it locates its own \`context.ts\` and the`,
            `  // existing resolver works unchanged; nothing is baked (ADR 0014). Lazy for the reason`,
            `  // the baked branch gives: both callers build a shim, and neither runs the app's own`,
            `  // \`createContext\` for a url nobody answers.`,
            `        const { req: __theoReq, res: __theoRes } = createWebShim(request)`,
            `  const resolveSubject = createAgentSubjectResolver({`,
            `    req: __theoReq,`,
            `    res: __theoRes,`,
            `    loadModule: ${source.loadModule},`,
            `    serverDir: ${source.serverDir},`,
            `    pluginRunner: ${source.pluginRunnerExpr ?? 'undefined'},`,
            `        })`,
          ],
    auxPrelude: [
      ...(source.ensureLoader === undefined ? [] : [`      ${source.ensureLoader}`]),
      `      // B-185 — hoisted above the lookup so a declined aux route loads no module. The scan`,
      `      // LISTS agent files; it imports none, so moving it here costs a declined request`,
      `      // nothing it was not already paying.`,
      `      if (!agentsCache) agentsCache = scanAgents(${source.projectRoot}${agentsDirArg})`,
      `      const auxDeps = {`,
      `        agents: agentsCache,`,
      `        loadModule: ${source.loadModule},`,
      `        baseUrl: url.origin,`,
      ...AUX_DEPS_PARITY,
      `      }`,
    ],
  }
}
