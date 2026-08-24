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
}

const EMPTY: DeployedAgentsFragment = { imports: [], declarations: [], branch: [] }

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
}

/** The prefix the agent convention owns. Matches `handlers.ts`'s own `tryServeAgent`. */
const AGENT_PREFIX = '/api/agents/'

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
    source.kind === 'baked' ? bakedResolution(source.agents) : scannedResolution(source)

  return {
    imports: [
      // `theokit/adapters/agent-mount`, not `theokit/server`: `mount-agent` is deliberately not on
      // the app-facing surface (ADR 0041), and a generated entry is not an app. See that module.
      `import { mountAgent, resolveProvider${source.kind === 'scan' ? ', scanAgents' : ''} } from '${prefix}theokit/adapters/agent-mount'`,
      ...resolution.imports,
    ],
    declarations: resolution.declarations,
    branch: [
      `    // #367 — the agent convention owns this prefix. It is answered BEFORE the file-route`,
      `    // table because an agent matches no file route: falling through is how a deployed`,
      `    // \`/api/agents/<name>\` used to 404 on every target.`,
      `    if (${pathname}.startsWith(${JSON.stringify(AGENT_PREFIX)})) {`,
      `      const agentName = ${pathname}.slice(${String(AGENT_PREFIX.length)}).split('/')[0]`,
      ...resolution.lookup,
      `      // A name nobody scanned is a 404, exactly like any other unknown path. Handing`,
      `      // \`undefined\` to mountAgent would surface as a 500 for what is a routing miss.`,
      `      if (mod === undefined) return ${notFound}`,
      `      const agentResponse = await mountAgent(mod, request, (model) => resolveProvider(model).apiKey, {`,
      `        agentName,`,
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
}

/** No filesystem: every agent module is a static import decided on the build machine. */
function bakedResolution(agents: readonly DeployedAgent[]): AgentResolution {
  const varOf = (index: number): string => `__theoAgent${String(index)}`
  return {
    imports: agents.map(
      (agent, index) => `import * as ${varOf(index)} from '../../${agent.filePath}'`,
    ),
    declarations: [
      `// #367 — the app's agents, keyed by NAME because that is what the URL carries, what the`,
      `// access policy is judged under, and what the run's spans are labelled with (#406).`,
      `const agents = {`,
      ...agents.map((agent, index) => `  ${JSON.stringify(agent.name)}: ${varOf(index)},`),
      `}`,
    ],
    lookup: [
      `      const mod = Object.prototype.hasOwnProperty.call(agents, agentName)`,
      `        ? agents[agentName]`,
      `        : undefined`,
    ],
  }
}

/** A filesystem: scan once and load on demand, exactly as this entry already treats its routes. */
function scannedResolution(source: {
  projectRoot: string
  loadModule: string
  ensureLoader?: string
}): AgentResolution {
  return {
    imports: [],
    declarations: [
      `// #367 — scanned on first use and cached, the same shape this entry already gives routes.`,
      `// Baking would tie an agent's existence to a rebuild on a target that has a filesystem.`,
      `let agentsCache = null`,
    ],
    lookup: [
      ...(source.ensureLoader === undefined ? [] : [`      ${source.ensureLoader}`]),
      `      if (!agentsCache) agentsCache = scanAgents(${source.projectRoot})`,
      `      const agentNode = agentsCache.find((a) => a.name === agentName)`,
      `      const mod = agentNode === undefined ? undefined : await ${source.loadModule}(agentNode.filePath)`,
    ],
  }
}
