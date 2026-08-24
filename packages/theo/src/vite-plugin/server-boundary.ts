/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time boundary check. The only paths handed to `fs` are derived from an import specifier
 * already inside the module graph, and every one of them is on the throw path — the check has
 * already decided to fail the build by the time a file is probed. No HTTP input reaches here.
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite'

import { ACTION_SCHEMAS_DIR } from '../server/internal-api.js'

import { resolveTheoRootDir } from './resolve-theo-root.js'

/**
 * The framework's server surface, as one specifier.
 *
 * Every server entry point in `packages/theo/package.json` is `./server` or a `./server/<name>`
 * subpath, so this prefix covers the whole surface without listing it — and a subpath added to the
 * `exports` map tomorrow is covered on the day it ships rather than the day someone remembers this
 * file. `tests/unit/server-boundary-rule.test.ts` reads that map and
 * asserts the correspondence in both directions, so the prefix cannot quietly start over- or
 * under-matching.
 */
const THEO_SERVER_SPECIFIER = 'theokit/server'

/** Extensions the boundary probes when naming the file behind a specifier. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'] as const

interface ServerOnlyImportErrorOptions {
  /** The server-only module, named the way the reader should recognise it. */
  module: string
  /** The file whose import statement crossed the boundary. */
  importer: string
  /** The specifier exactly as written, when it differs from `module`. */
  specifier?: string
}

/**
 * Thrown by the server-only import boundary when a module that runs on the server is pulled into
 * the CLIENT module graph.
 *
 * The failure it replaces was not the absence of one. `theokit build` already failed on this
 * mistake — with `"resolve" is not exported by "__vite-browser-external"`, pointing at a framework
 * chunk, after thirty lines of externalisation warnings (usetheokit/theokit#373). That names the
 * bundler's difficulty, not the author's. Worse, it is an accident: it happens because Node
 * builtins do not exist in a browser, so a server module that imported none of them would have
 * bundled cleanly and shipped.
 *
 * This error makes the boundary a rule instead of a side effect, and names the two things the
 * author needs — the module, and the file that imported it — the way `RouterConventionError` and
 * `MissingRoutePolicyError` already do for a bad route filename and an undeclared policy.
 */
export class ServerOnlyImportError extends Error {
  override readonly name = 'ServerOnlyImportError'
  /** The server-only module, as named in the message. */
  readonly module: string
  /** The importing file, as named in the message. */
  readonly importer: string

  constructor(opts: ServerOnlyImportErrorOptions) {
    const wroteSomethingElse = opts.specifier !== undefined && opts.specifier !== opts.module
    const message = [
      `Server-only import in the client bundle: ${opts.module} cannot be imported from client code.`,
      ``,
      `  Imported: ${opts.module}`,
      ...(wroteSomethingElse ? [`  Written:  ${String(opts.specifier)}`] : []),
      `  From:     ${opts.importer}`,
      ``,
      `That module runs on the server. It reads the file system, opens the database and holds`,
      `your secrets, so a browser bundle containing it ships all three to every visitor.`,
      ``,
      `Call the server from client code instead:`,
      ``,
      // Both bindings are the ones the virtual modules actually export — `client` from
      // `app-typed-client.ts` and `actions` from `actions-virtual-module.ts`. A remedy naming a
      // symbol nobody exports reads as actionable and is not, so
      // `tests/unit/server-boundary-rule.test.ts` asserts both against the emitters — the same
      // discipline `tests/unit/policy-gate-remedy-is-importable.test.ts` applies to the policy gate.
      `  import { client } from '@theo/client'    // typed from your server/routes/**`,
      `  import { actions } from '@theo/actions'  // typed from your server/actions/**`,
      ``,
      `Need only the TYPES? Add \`type\` to the import — a type-only import is erased before the`,
      `bundler ever sees it:`,
      ``,
      `  import type { ... } from '${opts.specifier ?? opts.module}'`,
      ``,
      `And if this file is itself server code, move it under your server directory, so the client`,
      `graph has no way to reach it.`,
    ].join('\n')
    super(message)
    this.module = opts.module
    this.importer = opts.importer
  }
}

/** True when `child` is inside `parent` (and is not `parent` itself). */
function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Name the file a specifier points at.
 *
 * A TypeScript ESM import writes `./health.js` for a file called `health.ts`, and an author told
 * to look at `server/routes/health.js` will open a file that does not exist. Runs only when the
 * boundary has already decided to throw, so the probing costs nothing on a passing build; falls
 * back to the unresolved path rather than inventing one.
 */
function nameSourceFile(target: string): string {
  if (existsSync(target) && statSync(target).isFile()) return target
  const stem = target.replace(/\.[cm]?[jt]sx?$/, '')
  for (const ext of SOURCE_EXTENSIONS) {
    if (existsSync(`${stem}${ext}`)) return `${stem}${ext}`
  }
  for (const ext of SOURCE_EXTENSIONS) {
    if (existsSync(join(target, `index${ext}`))) return join(target, `index${ext}`)
  }
  return target
}

/** Render a path relative to the project root, keeping it absolute when it lives outside. */
function forHumans(path: string, projectRoot: string): string {
  return isUnder(path, projectRoot) ? relative(projectRoot, path) : path
}

/**
 * Name a file inside the framework's own server tree the way its `package.json` publishes it.
 *
 * Two normalisations, both undoing something a bundler did to a specifier the author never wrote:
 *
 * - **The alias mangle.** `config-hook.ts` aliases the STRING `theokit/server` to a FILE, and a
 *   Vite string alias replaces by prefix, so `theokit/server/define` reaches this plugin as
 *   `…/server/index.ts/define`. That mid-path `/index.ts/` is the mangle — the same shape that
 *   surfaced as `ENOTDIR` in usetheokit/theokit#373 — and stripping it recovers `define`.
 * - **The barrel file.** `./server` and `./server/define` publish as `…/index.js` in `dist` and
 *   `…/index.ts` in source; a trailing barrel segment is not part of the specifier.
 *
 * The result is the string a reader can grep for in `packages/theo/package.json`.
 */
function frameworkServerSpecifier(target: string, theoServerDir: string): string {
  const demangled = target.replace(/[\\/]index\.[cm]?[jt]sx?(?=[\\/])/, '')
  const subpath = relative(theoServerDir, demangled)
    .replace(/\\/g, '/')
    .replace(/(^|\/)index\.[cm]?[jt]sx?$/, '')
  return subpath === '' ? THEO_SERVER_SPECIFIER : `${THEO_SERVER_SPECIFIER}/${subpath}`
}

export interface ServerBoundaryOptions {
  /** Absolute project root — paths in the message are shown relative to it. */
  projectRoot: string
  /** Absolute backend root (config `serverDir`, default `<projectRoot>/server`). */
  serverDir: string
}

/**
 * Refuse a server-only module in the client module graph, by name.
 *
 * ## Where the check lives, and why here
 *
 * In `resolveId`, at `enforce: 'pre'`. Three reasons, in the order they mattered:
 *
 * 1. **It is the only hook that sees the triple the message needs** — specifier, importer, and
 *    whether this is the client graph or the SSR one. A `package.json` `exports` map has no
 *    client/server condition a bundler honours for a build, and a standalone gate over `dist/`
 *    would have to rebuild the module graph Rollup just built.
 * 2. **`pre` runs ahead of the alias cascade.** `config-hook.ts` aliases `theokit/server` to a
 *    FILE, and a Vite string alias matches by prefix, so `theokit/server/define` used to resolve
 *    to `…/server/index.js/define` and fail with `ENOTDIR` — the second half of #373. Catching the
 *    specifier before the alias replaces it turns that into the same named refusal as the bare
 *    import. (The alias bug itself is untouched here — it is usetheokit/theokit#377, and it still
 *    breaks `theokit/client/core`, a published entry point that no boundary should refuse.)
 * 3. **It is on the path a consumer runs.** `theokit build` → `runAdapterBuild` → `nodeAdapter` →
 *    `viteBuild({ plugins: await ctx.makeVitePlugins(…) })` → `theoPluginAsync`, which returns this
 *    plugin. Nothing has to opt in, and `tests/integration/server-only-import-boundary.test.ts`
 *    exercises that chain rather than calling the hook.
 *
 * ## What counts as server-only
 *
 * Two rules, and one exception that is not a special case so much as the framework's own
 * declaration:
 *
 * - Anything under the published `theokit/server` surface (see {@link THEO_SERVER_SPECIFIER}).
 * - Anything under the project's own `serverDir`, EXCEPT `actions/<ACTION_SCHEMAS_DIR>/**`, which
 *   the `@theo/actions` facade deliberately imports into the client bundle. The exception reads
 *   the same constant the action scanner uses, so renaming the convention cannot turn a shipped
 *   feature into a build error on one side only.
 *
 * The second rule exists so the message names the page the author wrote. Without it a client page
 * importing `server/routes/health.ts` still fails — health.ts imports `theokit/server/define` — but
 * the importer named is `health.ts`, one hop away from the mistake.
 *
 * ## What it deliberately does not do
 *
 * It does not walk the import chain to report how a deeply nested server module was reached, and it
 * does not fire on the SSR graph, in `theokit build --target` SSR passes or under `ssrLoadModule`,
 * where importing server code is the entire point.
 */
export function serverOnlyImportBoundary(opts: ServerBoundaryOptions): Plugin {
  const projectRoot = opts.projectRoot
  const serverDir = opts.serverDir
  const isomorphicSchemasDir = join(serverDir, 'actions', ACTION_SCHEMAS_DIR)
  // The framework's own server tree on disk — `src/server` in this workspace, `dist/server` in an
  // installed copy. Resolved through the same helper `theoPlugin()` uses for its aliases, so the
  // boundary and the aliases can never point at different trees.
  const theoServerDir = join(resolveTheoRootDir(dirname(fileURLToPath(import.meta.url))), 'server')

  return {
    name: 'theo:server-only-import-boundary',
    enforce: 'pre',

    resolveId(source, importer, options) {
      // The SSR graph is allowed — and required — to import server code.
      if (options.ssr === true) return undefined
      // An entry point has no importer, so the message could not name one. A `theokit/server`
      // entry is a deliberate act in someone's Vite config, not the accident this catches.
      if (importer === undefined) return undefined

      // The specifier as the author wrote it. Reached only when no alias rewrote it first —
      // Vite's own alias plugin runs ahead of every `enforce: 'pre'` plugin, and `config-hook.ts`
      // installs an alias for exactly this prefix. Kept anyway so the boundary holds for a
      // consumer whose Vite config does not carry that alias.
      if (source === THEO_SERVER_SPECIFIER || source.startsWith(`${THEO_SERVER_SPECIFIER}/`)) {
        throw new ServerOnlyImportError({
          module: source,
          importer: forHumans(importer, projectRoot),
        })
      }

      // A bare specifier can never be a file, so only relative and absolute sources are resolved —
      // which keeps the common case to two string comparisons.
      if (source.startsWith('.') || isAbsolute(source)) {
        const target = isAbsolute(source) ? source : resolve(dirname(importer), source)

        // The framework's server surface, recognised by PATH because that is the form it arrives
        // in after the alias. Matching the tree rather than the specifier also catches a deep
        // reach into `theokit`'s internals that no `exports` subpath names.
        if (isUnder(target, theoServerDir)) {
          throw new ServerOnlyImportError({
            module: frameworkServerSpecifier(target, theoServerDir),
            importer: forHumans(importer, projectRoot),
          })
        }

        if (isUnder(target, serverDir) && !isUnder(target, isomorphicSchemasDir)) {
          throw new ServerOnlyImportError({
            module: forHumans(nameSourceFile(target), projectRoot),
            importer: forHumans(importer, projectRoot),
            specifier: source,
          })
        }
      }

      return undefined
    },
  }
}
