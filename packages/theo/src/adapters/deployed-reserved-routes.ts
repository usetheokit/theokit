/**
 * The reserved `/__theo/health` and `/__theo/ready` routes on a deployed Web entry
 * (usetheokit/theokit#1097).
 *
 * `theokit start` serves both before any user route (`cli/commands/start/request-handler.ts`,
 * `tryServeReserved`). The six entries the Web targets emit served neither, so both paths fell
 * through to the SPA document or a 404, and a platform health check pointed at `/__theo/ready`
 * read `200 text/html` as "ready".
 *
 * The answer comes from `serveReservedRoute`, the function `theokit start` calls, so the paths and
 * the JSON envelope cannot drift between the two.
 *
 * ## Why a declared `ready` probe fails closed here
 *
 * `ready` in `theo.config.ts` is a function, and a generated entry has no literal for a closure
 * (the reason `deployed-plugins-module.ts` gives for plugins). The jobs backend `ping()` that
 * `theokit start` folds in is a constructed object for the same reason, and `jobs.backend` is
 * already reported as not applied on these targets. So the entry cannot run the probe. Answering
 * `ready` on its behalf is the defect this exists to end, and an operator who declared a probe
 * asked for traffic to wait on it. The entry answers 503 and the build names the dropped key
 * (`config-support.ts`, concern `ready`).
 */

export interface DeployedReservedRoutesOptions {
  /** Whether `theo.config.ts` declares a `ready` probe, which no deployed entry can carry. */
  readyProbeDeclared?: boolean
}

export interface DeployedReservedRoutesFragment {
  readonly imports: readonly string[]
  readonly declarations: readonly string[]
}

/** The function the emitted handlers call; see {@link reservedRouteBranch}. */
const SERVE_FN = '__theoServeReservedRoute'

/**
 * The module-scope half: the import, the registry and the serving function.
 *
 * @param importPrefix - prefix for bare package specifiers; Deno needs `npm:`.
 */
export function deployedReservedRoutesFragment(
  opts: DeployedReservedRoutesOptions,
  importPrefix = '',
): DeployedReservedRoutesFragment {
  const declared = opts.readyProbeDeclared === true
  return {
    imports: [
      `import { serveReservedRoute${declared ? ', defineReadyRoute' : ''} } from '${importPrefix}theokit/server/http'`,
    ],
    declarations: [
      `// #1097 — /__theo/health and /__theo/ready, answered by the function \`theokit start\` calls.`,
      ...(declared
        ? [
            `// theo.config.ts declares a \`ready\` probe. It is a closure, which a generated entry cannot`,
            `// hold, so readiness fails closed (503) instead of answering ready on the probe's behalf.`,
            `const __THEO_RESERVED_ROUTES = { ready: defineReadyRoute(() => false) }`,
          ]
        : [`const __THEO_RESERVED_ROUTES = {}`]),
      `async function ${SERVE_FN}(pathname) {`,
      `  const reserved = await serveReservedRoute(pathname, __THEO_RESERVED_ROUTES)`,
      `  return reserved === null ? null : Response.json(reserved.body, { status: reserved.status })`,
      `}`,
    ],
  }
}

/**
 * The per-request half: two lines placed before the handler decides between `/api/*` and
 * everything else, so neither branch can claim the reserved paths first.
 */
export function reservedRouteBranch(pathname: string, indent: string): string[] {
  return [
    `${indent}const reservedResponse = await ${SERVE_FN}(${pathname})`,
    `${indent}if (reservedResponse !== null) return reservedResponse`,
  ]
}
