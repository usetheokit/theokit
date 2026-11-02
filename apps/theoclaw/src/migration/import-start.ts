import { isAbsolute } from 'node:path'

import type { AgentImport } from '../agent/create-agent.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import type { ProtectedPath } from '../tools/tool-settings.js'
import { type ImportedSetup, readImport } from './import-store.js'

/**
 * What the process entry does with an import at start (FR-010, FR-011): read it once the instance
 * is applied, check `THEOCLAW_IMPORTED_MCP`, and say what the `/control` agent will carry. Nothing
 * here prints a value of an MCP entry (NFR-003).
 */

/** `THEOCLAW_IMPORTED_MCP`: `on` or unset, checked on every start, with an import or not. */
export function requireImportedMcp(env: NodeJS.ProcessEnv): boolean {
  const value = env.THEOCLAW_IMPORTED_MCP
  if (value === undefined) return false
  if (value === 'on') return true
  throw new TheoClawConfigError('THEOCLAW_IMPORTED_MCP must be on or unset', { variable: 'THEOCLAW_IMPORTED_MCP' })
}

/**
 * The import under `THEOCLAW_STATE_DIR`, or `undefined` with the variable unset or no import. Each
 * `loadMcpJson` warning is written to `stderr` as a note (EC-10); those messages name a server and a
 * variable, never a value.
 */
export function readImportAtStart(env: NodeJS.ProcessEnv, stderr: (line: string) => void): ImportedSetup | undefined {
  const stateDir = (env.THEOCLAW_STATE_DIR ?? '').trim()
  if (stateDir === '') return undefined
  return readImport(stateDir, { onWarn: (warning) => stderr(`theoclaw: import note: ${warning}`), env })
}

/** The start's line naming the import, written after the instance line. */
export function importedSetupLine(imported: ImportedSetup, mcp: boolean): string {
  const { instructions, memories, skills, mcpServers } = imported.counts
  return (
    `theoclaw: imported ${imported.kind} setup: ${instructions} instruction files, ${memories} memory files, ` +
    `${skills} skills, ${mcpServers} MCP servers (${mcp ? 'on' : 'off: set THEOCLAW_IMPORTED_MCP=on'})`
  )
}

/**
 * The paths an import's servers execute from, when `THEOCLAW_IMPORTED_MCP=on` starts them: every
 * absolute stdio command and working directory. Each is a host process outside the sandbox, so with
 * host tools on the start refuses any of them inside a root the shell can write, as it does for the
 * external tools file (`externalToolPaths`).
 */
export function importedMcpPaths(imported: AgentImport | undefined): ProtectedPath[] {
  if (imported === undefined || !imported.mcp) return []
  const executed = Object.values(imported.setup.mcpServers).flatMap((server) =>
    'url' in server ? [] : [server.command, ...(server.cwd === undefined ? [] : [server.cwd])],
  )
  return executed.filter((path) => isAbsolute(path)).map((path) => ({ path, variable: 'THEOCLAW_IMPORTED_MCP' }))
}
