import { loadMcpScopes, type McpScopesResult } from '@theokit/agents'

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
  readonly servers: McpScopesResult['servers']
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
  const personalDir = homeStateDir(opts.env, opts.home)
  const result = loadMcpScopes({
    cwd: opts.cwd,
    home: opts.home,
    personalFiles: [personalDir],
    onClash: 'personal-wins',
    projectAllowed: opts.posture.allows.mcp,
    ...(opts.onWarn === undefined ? {} : { onWarn: opts.onWarn }),
  })
  // Wording is ours: the framework reports the clash as data, the operator reads this sentence.
  for (const { name } of result.shadowed) {
    opts.onWarn?.(
      `mcp: the project also declares a server named "${name}"; using yours and ignoring the project's`,
    )
  }
  return {
    servers: result.servers,
    personal: result.personal,
    projectWithheld: result.projectWithheld,
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
