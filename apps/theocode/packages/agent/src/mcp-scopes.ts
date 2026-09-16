import { loadMcpJson } from '@theokit/agents'

import { homedir } from 'node:os'

import { homeStateDir } from './config/home-dir.js'
import type { TrustPosture } from './config/index.js'

/**
 * The MCP servers this build will start: the operator's own, plus the project's when it is trusted.
 *
 * Lifted out of `chat.ts` for the reason it was lifted there in the first place: it is a TRUST GATE,
 * and a gate buried in a ternary inside a 60-line function is where nobody looks. It now has two
 * scopes and a collision rule, which is more than a ternary should carry in any case.
 *
 * `onWarn` travels with it deliberately. Without it the framework sends warnings to stderr — which
 * under the TUI is a log file nobody has open — while `/mcp` cheerfully lists the servers that DID
 * load and never says one was ignored.
 */
export interface McpScopes {
  /** Both scopes, merged — the map handed to `.mcp()`. */
  readonly servers: ReturnType<typeof loadMcpJson>
  /** The names that came from the operator's own file, so the wiring record can report them apart. */
  readonly personal: readonly string[]
  /**
   * The project's declared server names when trust withheld them — named, never started.
   *
   * Measured 2026-09-04: without this, `suppressedByTrust` was ALWAYS false for MCP, because
   * `recordWiring` derives it from "something was requested AND the posture refused it" and the
   * project's file was never read when the posture refused. So an operator in an untrusted
   * directory saw `mcp: none` while their repository declared three servers, and the diagnostic had
   * no way to say why they were missing.
   *
   * Reading is parsing, not executing: the file is loaded to obtain names for the report, and the
   * map is discarded. Nothing from it reaches `.mcp()`.
   */
  readonly projectWithheld: readonly string[]
}

export function mcpServersFor(opts: {
  readonly posture: TrustPosture
  readonly cwd: string
  readonly home: string
  readonly env: Record<string, string | undefined>
  readonly onWarn?: (warning: string) => void
}): McpScopes {
  const personal = scope(homeStateDir(opts.env, opts.home), opts.onWarn)
  const projectScope = scope(opts.cwd, opts.onWarn)
  const project = opts.posture.allows.mcp ? projectScope : {}
  const projectWithheld = opts.posture.allows.mcp ? [] : Object.keys(projectScope)

  const merged: Record<string, unknown> = { ...project }
  for (const [name, server] of Object.entries(personal)) {
    // The personal definition wins. Project-wins would let a repository shadow a server the operator
    // trusts by reusing its name with a different command — a hijack whose only symptom is that the
    // right tool does the wrong thing. Warned rather than silent, because a server that vanished
    // without explanation is debugged as a product defect.
    if (name in merged) {
      opts.onWarn?.(
        `mcp: the project also declares a server named "${name}"; using yours and ignoring the project's`,
      )
    }
    merged[name] = server
  }
  return {
    servers: merged as ReturnType<typeof loadMcpJson>,
    personal: Object.keys(personal),
    projectWithheld,
  }
}

/**
 * One scope's servers, or none.
 *
 * `loadMcpJson` THROWS on a read failure, invalid JSON, or a shape violation. Caught per scope so a
 * malformed file in one does not silence the other: an unreadable personal file must not take the
 * project's servers down with it, and the reverse holds too. The failure is reported, never
 * swallowed — that is the difference between a caught error and an ignored one.
 */
function scope(dir: string, onWarn?: (warning: string) => void): Record<string, unknown> {
  try {
    return loadMcpJson(dir, ...(onWarn === undefined ? [] : [{ onWarn }])) as Record<string, unknown>
  } catch (error) {
    onWarn?.(`mcp: ignoring ${dir}/.mcp.json — ${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
}

/**
 * The ambient half of `mcpServersFor` — the real home and the real environment, read in one place.
 *
 * Separated so `buildChatAgent` keeps one statement for the decision and so the seams stay injectable
 * for the tests that exercise both scopes.
 */
export function mcpScopes(
  posture: TrustPosture,
  cwd: string,
  onWarn?: (warning: string) => void,
): McpScopes {
  return mcpServersFor({
    posture,
    cwd,
    home: homedir(),
    env: process.env,
    ...(onWarn === undefined ? {} : { onWarn }),
  })
}
