/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time manifest emitter / loader. All paths derived from `distDir`
 * + `serverDir`, themselves resolved from `process.cwd()`. No HTTP input.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, relative, dirname } from 'node:path'

import { scanServerActions } from './action-scan.js'
import type { ActionNode } from './action-scan.js'
import { scanAgents } from './agent-scan.js'
import type { AgentNode } from './agent-scan.js'
import { compilePattern } from './match.js'
import type { ServerRouteNode } from './match.js'
import { scanServerRoutes } from './scan.js'
import { scanWebSocketRoutes } from './ws-scan.js'
import type { WebSocketRouteNode } from './ws-scan.js'

// --- Manifest Types ---

export interface ManifestRoute {
  filePath: string
  routePath: string
  paramNames: string[]
  /** HTTP methods (uppercase) the route file exports. Optional — manifests
   * generated before G1 omit this; loaders treat absence as "unknown". */
  methods?: string[]
  /**
   * The subset of `methods` declaring `policy('public')`. Optional for the same reason `methods`
   * is: a manifest written before the field existed has none, and `public-exposure-gate.ts` reads
   * that absence as "not measured" rather than as "nothing is public".
   */
  publicMethods?: string[]
}

export interface ManifestAction {
  filePath: string
  actionPath: string
}

export interface ManifestWebSocket {
  filePath: string
  wsPath: string
}

/** M2 — a top-level `agents/*.ts` convention entry. `filePath` is relative to the
 * project root (agents live OUTSIDE `serverDir`), unlike routes/actions/ws. */
export interface ManifestAgent {
  filePath: string
  agentPath: string
  name: string
}

export interface TheoManifest {
  version: 1
  generatedAt: string
  /**
   * FILE routes — what `scanServerRoutes` finds under `<serverDir>/routes`. Controllers are NOT
   * here, and that is deliberate: they ship as a separate `controllers.json` so a deploy adapter
   * that knows nothing about them keeps working unchanged (see `emit-controllers.ts`).
   *
   * Which makes `routes: []` ambiguous, and the ambiguity is worth stating rather than leaving for
   * each reader to rediscover. It means "no file routes" — never "this app serves nothing". Measured
   * on a nine-controller app: sixteen routes served, `routes: []` written (theokit#543). Anything
   * answering "what does this app serve?" must read `controllers.json` too; `public-exposure-gate`
   * is the one that had to learn this the expensive way.
   */
  routes: ManifestRoute[]
  actions: ManifestAction[]
  websockets: ManifestWebSocket[]
  /** M2 — optional for backward compat: manifests generated before M2 omit it. */
  agents?: ManifestAgent[]
}

export interface LoadedManifest {
  routes: ServerRouteNode[]
  actions: ActionNode[]
  websockets: WebSocketRouteNode[]
  agents: AgentNode[]
}

// --- Generate ---

export function generateManifest(
  serverDir: string,
  // Agents live at `<projectRoot>/<agentsDir>`. Defaults to the server dir's parent; overridable
  // for tests / non-standard layouts.
  projectRoot: string = dirname(serverDir),
  // Agents dir NAME (config `agentsDir`, default "agents"), relative to projectRoot (#95 follow-up).
  agentsDir = 'agents',
): TheoManifest {
  const routes = scanServerRoutes(serverDir)
  const actions = scanServerActions(serverDir)
  const websockets = scanWebSocketRoutes(serverDir)
  const agents = scanAgents(projectRoot, agentsDir)

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    routes: routes.map((r) => ({
      filePath: relative(serverDir, r.filePath),
      routePath: r.routePath,
      paramNames: r.paramNames,
      ...(r.methods !== undefined ? { methods: r.methods } : {}),
      ...(r.publicMethods !== undefined ? { publicMethods: r.publicMethods } : {}),
    })),
    actions: actions.map((a) => ({
      filePath: relative(serverDir, a.filePath),
      actionPath: a.actionPath,
    })),
    websockets: websockets.map((w) => ({
      filePath: relative(serverDir, w.filePath),
      wsPath: w.wsPath,
    })),
    agents: agents.map((a) => ({
      // Relative to projectRoot (agents/ is outside serverDir).
      filePath: relative(projectRoot, a.filePath),
      agentPath: a.agentPath,
      name: a.name,
    })),
  }
}

// --- Write ---

export function writeManifest(manifest: TheoManifest, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true })
  const manifestPath = join(outputDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
}

// --- Load ---

export function loadManifest(distDir: string, serverDir: string): LoadedManifest {
  const manifestPath = join(distDir, 'manifest.json')

  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest found at ${manifestPath}. Run "theo build" first.`)
  }

  const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as TheoManifest

  const routes: ServerRouteNode[] = raw.routes.map((r) => {
    const { pattern, paramNames } = compilePattern(r.routePath)
    return {
      filePath: resolve(serverDir, r.filePath),
      routePath: r.routePath,
      paramNames,
      pattern,
      ...(r.methods !== undefined ? { methods: r.methods } : {}),
      ...(r.publicMethods !== undefined ? { publicMethods: r.publicMethods } : {}),
    }
  })

  const actions: ActionNode[] = raw.actions.map((a) => ({
    filePath: resolve(serverDir, a.filePath),
    actionPath: a.actionPath,
  }))

  const websockets: WebSocketRouteNode[] = raw.websockets.map((w) => ({
    filePath: resolve(serverDir, w.filePath),
    wsPath: w.wsPath,
  }))

  // M2 — agents resolve relative to the project root (sibling of serverDir).
  // `?? []` keeps pre-M2 manifests (no `agents` field) loadable (fail-safe).
  const projectRoot = dirname(serverDir)
  const agents: AgentNode[] = (raw.agents ?? []).map((a) => ({
    filePath: resolve(projectRoot, a.filePath),
    agentPath: a.agentPath,
    name: a.name,
  }))

  return { routes, actions, websockets, agents }
}
