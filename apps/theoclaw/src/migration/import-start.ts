import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { AgentImport } from '../agent/create-agent.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { secretsOf } from '../tools/external-tools.js'
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

type StdioServer = Extract<ImportedSetup['mcpServers'][string], { readonly command: string }>

/** The path an argument names: itself, or the value of a `--flag=value`; never a flag, a URL or an empty value. */
function pathOf(arg: string): string | undefined {
  const value = arg.startsWith('-') ? arg.slice(arg.indexOf('=') + 1) : arg
  return value === '' || value.startsWith('-') || value.includes('://') ? undefined : value
}

/**
 * What one stdio server executes, resolved as the SDK spawns it: its cwd against the process
 * directory, then a command with a slash and each argument against that cwd. An argument counts
 * when it is absolute, has a slash, or is a file in the cwd: an interpreter's script (`node
 * server.js`) is the code that runs, and the commonest shape of a project `.mcp.json`.
 */
function executedPaths(server: StdioServer, processCwd: string): string[] {
  const cwd = resolve(processCwd, server.cwd ?? '.')
  const command = server.command.includes('/') ? [resolve(cwd, server.command)] : []
  const args = (server.args ?? []).flatMap((arg) => {
    const path = pathOf(arg)
    if (path === undefined) return []
    const resolved = resolve(cwd, path)
    return isAbsolute(path) || path.includes('/') || existsSync(resolved) ? [resolved] : []
  })
  return [...command, ...(server.cwd === undefined ? [] : [cwd]), ...args]
}

/**
 * The paths an import's servers execute from, when `THEOCLAW_IMPORTED_MCP=on` starts them: every
 * stdio command with a slash, working directory and script argument (`executedPaths`). Each is run by
 * a host process outside the sandbox, so with host tools on the start refuses any of them inside a
 * root the shell can write, as it does for the external tools file (`externalToolPaths`).
 */
export function importedMcpPaths(imported: AgentImport | undefined, processCwd = process.cwd()): ProtectedPath[] {
  if (imported === undefined || !imported.mcp) return []
  return Object.values(imported.setup.mcpServers)
    .flatMap((server) => ('url' in server ? [] : executedPaths(server, processCwd)))
    .map((path) => ({ path, variable: 'THEOCLAW_IMPORTED_MCP' }))
}

/**
 * The import's env and header values the output mask hides (NFR-003), by the rule the external tools
 * file's follow (`secretsOf`). Masked with the servers off too: the values are read at every start.
 */
export function importedMcpSecrets(imported: AgentImport | undefined): string[] {
  return imported === undefined ? [] : secretsOf(imported.setup.mcpServers)
}
