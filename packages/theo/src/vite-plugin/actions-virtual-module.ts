/**
 * Vite plugin: resolves `@theo/actions` virtual module and emits a typed
 * Proxy facade that calls `theoFetch('/_actions/<name>', body)` against the
 * server-side action handlers.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 3 / T3.1 + ADR D4.
 * Astro `vite-plugin-actions.ts` modular pattern. Single focused plugin
 * (not monolithic), virtual module + `configureServer` watcher.
 *
 * Module shape emitted on client environment: thin proxy that forwards
 * `actions.<name>(input)` to `POST /_actions/<name>` with JSON or
 * FormData body. On server environment: re-export of the manifest for
 * SSR / module-loader access (T1.3 sub-C consumer).
 *
 * EC-15 (DOCUMENT): HMR uses Vite default invalidation — coarse but
 * correct. Optimization (fine-grained invalidation of only consumers of
 * `@theo/actions`) deferred to G3.1 if dev-server p95 reload > 500ms.
 */
import { existsSync, mkdirSync, renameSync, watch as fsWatch, writeFileSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'

import type { Plugin, ViteDevServer } from 'vite'

import { scanServerActionsEnriched, type ActionManifestEntry } from '../server/scan/action-scan.js'

const VIRTUAL_ID = '@theo/actions'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

export interface ActionsVirtualModuleOptions {
  /** Path to server directory (where `actions/` lives). */
  serverDir: string
  /**
   * Optional `.theo/` output dir for emitting `actions.d.ts`. When provided,
   * the plugin writes an ambient `declare module '@theo/actions'` so TS in
   * consumer apps can resolve the virtual module import. Mirrors the G1
   * `app-typed-client` emit pattern.
   */
  distDir?: string
}

export function actionsVirtualModule(opts: ActionsVirtualModuleOptions): Plugin {
  const { serverDir, distDir } = opts

  function emitActionsDts(): void {
    if (distDir === undefined) return
    const entries = safeScan(serverDir)
    const dtsPath = posix.join(resolve(distDir).replace(/\\/g, '/'), 'actions.d.ts')
    const content = generateActionsDts(entries)
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time derived path
      mkdirSync(dirname(dtsPath), { recursive: true })
      const tmp = `${dtsPath}.${process.pid}.tmp`
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time derived path
      writeFileSync(tmp, content)
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time derived path
      renameSync(tmp, dtsPath)
    } catch (err) {
      console.error('[theokit:actions-virtual-module] dts emit error:', err)
    }
  }

  return {
    name: 'theo:actions-virtual-module',
    enforce: 'pre',
    configResolved() {
      emitActionsDts()
    },
    buildEnd() {
      emitActionsDts()
    },
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return undefined
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return undefined
      const entries = safeScan(serverDir)
      const ctx = this as unknown as { environment?: { name?: string } } | undefined
      const envName = ctx?.environment?.name
      const isClient = envName === 'client' || envName === undefined
      return isClient ? generateClientFacade(entries) : generateServerManifest(entries)
    },
    configureServer(server: ViteDevServer) {
      const actionsDir = join(serverDir, 'actions')
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time derived path
      if (!existsSync(actionsDir)) return
      // EC-15: coarse invalidation — invalidate ALL modules on actions file change.
      // Optimization deferred per plan ADR D4 note.
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time path
      const watcher = fsWatch(actionsDir, { recursive: true }, () => {
        emitActionsDts()
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
        }
        server.ws.send({ type: 'full-reload' })
      })
      server.httpServer?.once('close', () => {
        watcher.close()
      })
    },
  }
}

/**
 * Emit `.theo/actions.d.ts` — ambient declaration of `@theo/actions` so
 * consumer TS apps can `import { actions } from '@theo/actions'` and get
 * typed completions for each scanned action name. Each entry maps name to
 * a generic `(input: unknown) => Promise<{data, error}>` invoker — the full
 * input/output inference from defineAction would require either monomorphic
 * dts-bundle or virtual type emit (deferred to a future plan).
 */
function generateActionsDts(entries: readonly ActionManifestEntry[]): string {
  const lines = entries
    .map(
      (entry) =>
        `    ${JSON.stringify(entry.name)}: (input: unknown) => Promise<{ data: unknown; error: undefined } | { data: undefined; error: { code: string; message: string; fields?: Record<string, string[]>; type?: string } }>`,
    )
    .join('\n')
  return `// AUTO-GENERATED by @theo/actions virtual module. DO NOT EDIT MANUALLY.
declare module '@theo/actions' {
  export const actions: {
${lines}
  }
}
`
}

function safeScan(serverDir: string): ActionManifestEntry[] {
  try {
    return scanServerActionsEnriched(serverDir)
  } catch {
    // ActionScanError surfaces at build time; for HMR keep an empty manifest
    // so the dev server doesn't crash mid-edit.
    return []
  }
}

/**
 * Client-side module: emits a Proxy facade. For each action `name` in
 * manifest, `actions.<name>(input)` POSTs to `/_actions/<name>` with JSON
 * body (or FormData when input is a FormData instance) and parses the
 * `application/json+devalue` response via the runtime helper.
 */
function generateClientFacade(entries: ActionManifestEntry[]): string {
  const entryLines = entries
    .map((entry) => `  ${JSON.stringify(entry.name)}: ${JSON.stringify(entry.urlPath)},`)
    .join('\n')

  return `// AUTO-GENERATED by @theo/actions virtual module
/* eslint-disable */
const ACTION_URL_MAP = {
${entryLines}
}

async function callAction(url, input) {
  const isForm = typeof FormData !== 'undefined' && input instanceof FormData
  const headers = { 'x-theo-action': '1' }
  const body = isForm ? input : JSON.stringify(input ?? {})
  if (!isForm) headers['content-type'] = 'application/json'
  const response = await fetch(url, { method: 'POST', headers, body, credentials: 'same-origin' })
  const contentType = response.headers.get('content-type') ?? ''
  if (response.status === 204) return { data: undefined, error: undefined }
  if (contentType.startsWith('application/json+devalue')) {
    const text = await response.text()
    const { parse } = await import('devalue')
    return { data: parse(text, { URL: (h) => new URL(h) }), error: undefined }
  }
  if (contentType.startsWith('application/json')) {
    const json = await response.json()
    if (response.ok) return { data: json, error: undefined }
    return { data: undefined, error: json }
  }
  return { data: undefined, error: { code: 'INTERNAL_SERVER_ERROR', message: await response.text() } }
}

export const actions = new Proxy({}, {
  get(target, prop) {
    if (typeof prop !== 'string') return undefined
    const url = ACTION_URL_MAP[prop]
    if (!url) return undefined
    return (input) => callAction(url, input)
  },
})
`
}

/**
 * Server-side module: re-exports the manifest entries for SSR / module-
 * loader consumption (T1.3 sub-C in action-execute.ts will route requests
 * via this manifest).
 */
function generateServerManifest(entries: ActionManifestEntry[]): string {
  return `// AUTO-GENERATED by @theo/actions virtual module (server env)
/* eslint-disable */
export const manifest = ${JSON.stringify(entries, null, 2)}
export const actions = manifest
`
}
