import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { UsageError } from '../cli-args.js'
import { MCP_SERVER_NAME } from './serve-tools.js'

/** How long a grant from `theoclaw attach` lasts. */
export const ATTACH_TTL_MS = 60 * 60 * 1000

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/

export interface AttachGrant {
  readonly config: {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
  }
  readonly session: string
  readonly expiresAt: string
}

/**
 * A Claude Code MCP config that starts `theoclaw mcp` bound to one session and expiring after an
 * hour. `command` and `args` start the theoclaw CLI (`args` is the script path, or empty for the
 * standalone binary).
 */
export function mintAttachGrant(
  launch: { command: string; args: readonly string[] },
  session: string,
  now = Date.now(),
): AttachGrant {
  if (!SESSION_ID.test(session))
    throw new UsageError('theoclaw attach: --session must be 1 to 64 letters, digits, "-" or "_"')
  const expiresAt = new Date(now + ATTACH_TTL_MS).toISOString()
  return {
    session,
    expiresAt,
    config: {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          command: launch.command,
          args: [...launch.args, 'mcp'],
          env: { THEOCLAW_SESSION: session, THEOCLAW_MCP_EXPIRES_AT: expiresAt },
        },
      },
    },
  }
}

/** Writes the config to a private temporary directory; `remove` deletes it. */
export function writeAttachConfig(grant: AttachGrant): { path: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-attach-'))
  const path = join(dir, '.mcp.json')
  writeFileSync(path, `${JSON.stringify(grant.config, null, 2)}\n`, { mode: 0o600 })
  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) }
}
