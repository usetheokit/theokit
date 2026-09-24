/**
 * Why the OTLP probe could not LOAD the thing it measures, and the command that fixes it.
 *
 * B-303 — `pnpm probe:otlp` is `npx tsx scripts/probe-otlp-delivery.ts`, the invocation the probe's
 * own docblock gives as the example, and from a clean checkout it raised `ERR_MODULE_NOT_FOUND`
 * twice: first `@theokit/sdk`, with nothing installed, then `@theokit/presenter/dist/index.js`, with
 * nothing built — the probe drives `packages/agents/src`, which imports a sibling's `dist`. Both
 * crashes exited 1, and the probe's header defines exit 1 as *"the run produced no span, the
 * collector refused the payload, or the transport never reached it"*. None of those happened. An
 * operator was told a collector had refused a payload that had never been built.
 *
 * Neither failure is measurable by the probe, so both belong in the band it already has for that:
 * exit 2, *"the probe could not measure"*. Nothing new was invented — a missing dependency and an
 * unbuilt sibling are preconditions that were not met, which is what that band means.
 *
 * ## Why two kinds and not one sentence
 *
 * `pnpm install` and `pnpm build:packages` are different commands, and the probe's header states the
 * rule a single message would break: *"a shared exit code is not a shared diagnosis, and naming the
 * wrong one sends the reader to the wrong system"*. `endpoint-can-refuse.ts` records what collapsing
 * causes cost the last time — four conditions behind one boolean, all printing a sentence that named
 * a cause nobody had observed.
 *
 * ## The decision is a filesystem question, not a string one
 *
 * pnpm links a workspace dependency into its consumer's own `node_modules`, so the path Node reports
 * for the second crash is not under `packages/presenter/` at all — it is
 * `packages/agents/node_modules/@theokit/presenter/dist/index.js`. Reading `/dist/` out of the path
 * as text would also catch a third-party package's missing `dist`, which is a broken install and not
 * something a build can fix. So the unresolved path is walked up to its package root and
 * `realpath`ed: if that lands inside this repository's `packages/`, the sibling was never built.
 * Node's error prose is read only to NAME what failed; what to do about it comes from disk.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A precondition the probe needs and does not have.
 *
 * `fix` is carried here rather than composed by the caller so the classification and the remedy
 * cannot drift apart: a new kind cannot be added without stating what resolves it.
 */
export type ImportPrecondition =
  | {
      /** Something the probe imports is not installed. */
      readonly kind: 'dependencies'
      /** The package or path Node could not resolve, as the operator will recognise it. */
      readonly specifier: string
      readonly fix: 'pnpm install'
    }
  | {
      /** A workspace sibling's build output is missing, and the probe reads source that imports it. */
      readonly kind: 'workspace-build'
      readonly specifier: string
      /** Which sibling, so the reader is not left to guess which of seven packages it was. */
      readonly pkg: string
      readonly fix: 'pnpm build:packages'
    }

/** How deep a package root may sit below the file that failed. Bounds the walk; never reached in practice. */
const MAX_WALK = 24

/** The quoted specifier Node puts in `Cannot find package '…'` / `Cannot find module '…'`. */
function specifierIn(message: string): string | null {
  return /Cannot find (?:package|module) '([^']+)'/.exec(message)?.[1] ?? null
}

/** The absolute path that failed to resolve, from `url` when Node carries one, else from the message. */
function unresolvedPath(error: Error & { url?: unknown }): string | null {
  if (typeof error.url === 'string' && error.url.startsWith('file:')) {
    try {
      return fileURLToPath(error.url)
    } catch {
      // A malformed URL is not worth failing over: the message fallback below still names the file,
      // and misreading it costs the other command rather than a silent pass.
    }
  }
  const quoted = specifierIn(error.message)
  // `=== true` rather than a bare optional chain: `undefined` is falsy and would read the same here,
  // and the next edit that drops the comparison would make it read the same somewhere it does not.
  return quoted?.startsWith(sep) === true ? quoted : null
}

/** `name` from a manifest, or `null` when it cannot be read as one. */
function manifestName(dir: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const name = (parsed as { name?: unknown }).name
    return typeof name === 'string' ? name : null
  } catch {
    return null
  }
}

/**
 * The workspace package `filePath` belongs to, or `null` when it belongs to none.
 *
 * Walks up to the nearest directory holding a `package.json` — the file itself does not exist, which
 * is the whole reason we are here — and resolves symlinks before asking whether it sits under
 * `<repoRoot>/packages/`. Both halves matter: without the walk there is no manifest to name, and
 * without `realpath` pnpm's link out of a consumer's `node_modules` reads as a foreign package.
 */
function workspacePackageOf(filePath: string, repoRoot: string): string | null {
  let packages: string
  try {
    packages = realpathSync(join(repoRoot, 'packages'))
  } catch {
    return null
  }

  let dir = dirname(filePath)
  for (let depth = 0; depth < MAX_WALK; depth += 1) {
    if (existsSync(join(dir, 'package.json'))) {
      let real: string
      try {
        real = realpathSync(dir)
      } catch {
        return null
      }
      if (!real.startsWith(packages + sep)) return null
      return manifestName(real) ?? real.slice(packages.length + 1)
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * Which precondition a failed `import()` reveals — or `null` when it reveals none.
 *
 * `null` is the case that keeps this honest: a module that RESOLVED and then threw is a defect in
 * this repository, and answering it with `pnpm install` would be the same misdirection B-303 records,
 * pointed the other way. The caller rethrows on `null`, so a real fault still produces a stack.
 */
export function classifyImportFailure(error: unknown, repoRoot: string): ImportPrecondition | null {
  if (!(error instanceof Error)) return null
  if ((error as { code?: unknown }).code !== 'ERR_MODULE_NOT_FOUND') return null

  const path = unresolvedPath(error)
  if (path !== null) {
    const pkg = workspacePackageOf(path, repoRoot)
    if (pkg !== null) {
      return { kind: 'workspace-build', specifier: path, pkg, fix: 'pnpm build:packages' }
    }
  }

  return {
    kind: 'dependencies',
    specifier: specifierIn(error.message) ?? path ?? 'a module the probe imports',
    fix: 'pnpm install',
  }
}
