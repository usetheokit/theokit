import { TheoClawConfigError } from '../control-plane/errors.js'
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
