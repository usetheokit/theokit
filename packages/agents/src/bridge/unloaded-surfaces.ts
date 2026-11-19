/**
 * B-027 — `.claude/workflows/*.js`, found and deliberately not executed.
 *
 * The item's Definition of Done named the two acceptable answers: load the surface, or declare it
 * out of scope with a reason that is about THIS PRODUCT rather than about effort. It also supplied
 * the reason, and the reason holds:
 *
 *   "an executable JS file that orchestrates subagents is a different trust proposition from a
 *    markdown prompt, and that is a legitimate reason to refuse it"
 *
 * Every surface this layer does admit — `commands`, `hooks`, `plugins`, `skills`, `subagents`
 * (`setting-sources-gate.ts`) — is DATA. A workflow file is CODE. In the reference, a person chose
 * to start a CLI in a directory; here the directory is an argument to a library, so loading this
 * surface would make `cwd` an execution vector for every consumer of the package. That decision
 * belongs to the consumer, and a library that takes it on their behalf has taken it silently.
 *
 * ## What is refused, and what is not
 *
 * The ORCHESTRATION is supported: `@theokit/sdk` exports `Workflow`, `agentStep` and `createSquad`,
 * and composing many subagents from a script is typed and tested. What is refused is DISCOVERING
 * AND EXECUTING a file found on disk. The report says so, because a refusal that does not name the
 * supported path sends the reader to a changelog to find out whether the capability exists at all.
 *
 * ## Why this reports instead of staying silent
 *
 * Silence is the defect the whole backlog is about, in its third instance: the dropped `alwaysLoad`
 * in `mcp-file.ts`, the output style nothing read in B-022, and a `workflows/` directory whose
 * author sees no complaint and concludes it took effect. The cost of the report is one line.
 */
import { scanForeignSurfaces, WORKFLOW_REFUSAL_REASON } from './foreign-surfaces.js'

/** Where the reference keeps workflow scripts, relative to a project root. */
const WORKFLOWS_DIR = '.claude/workflows'

export interface ReportUnloadedSurfacesInput {
  /** Project root whose `.claude/` is inspected. */
  readonly cwd: string
  /** Where a report goes. Called once per unloaded surface that is actually present. */
  readonly onWarn: (warning: string) => void
}

/**
 * Report the `.claude` surfaces that are present on disk and deliberately not loaded.
 *
 * Built on the foreign-surface inventory. Says nothing when there is nothing to say: a reporter that
 * fired on every project would be noise, and noise is how a real report stops being read. An
 * unreadable directory is not a workflow anybody wrote, so it stays quiet too.
 */
export function reportUnloadedSurfaces(input: ReportUnloadedSurfacesInput): void {
  const workflows = scanForeignSurfaces({ cwd: input.cwd }).find(
    ({ entry }) => entry.dir === 'workflows',
  )
  if (workflows === undefined || workflows.entry.count === 0) return

  input.onWarn(
    `${WORKFLOWS_DIR}: found ${String(workflows.entry.count)} workflow script(s) — ` +
      `${[...workflows.names].sort((a, b) => a.localeCompare(b)).join(', ')} — which this runtime does NOT ` +
      `execute. ${WORKFLOW_REFUSAL_REASON}`,
  )
}
