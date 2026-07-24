/**
 * M17 (theokit-ai-first) — createACPTool: wrap a coding agent (Claude Code, Amp, Codex) as a tool.
 *
 * Spawns the agent as a subprocess (Node `child_process` — an adapter concern per G8), drives it
 * with the transport-agnostic {@link AcpClient} over newline-delimited JSON-RPC, and returns a
 * `CustomTool`. `onPermissionRequest` is REQUIRED — security by default (no default-allow for file/
 * shell operations). The transport is injectable for tests.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

import { AcpClient, type AcpTransport } from '@theokit/agents'
import type { CustomTool } from '@theokit/sdk'

/** Stdio transport backed by a spawned subprocess (the default for {@link createACPTool}). */
export class NodeAcpTransport implements AcpTransport {
  // stdin=pipe, stdout=pipe, stderr=inherit → the third stream is null.
  private readonly proc: ChildProcessByStdio<Writable, Readable, null>

  constructor(command: string, args: string[] = [], cwd?: string) {
    this.proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'inherit'] })
  }

  send(line: string): void {
    this.proc.stdin.write(line)
  }

  subscribe(onData: (chunk: string) => void): void {
    this.proc.stdout.on('data', (buf: Buffer) => {
      onData(buf.toString('utf8'))
    })
  }

  close(): void {
    this.proc.kill()
  }
}

export interface AcpToolConfig {
  /** Executable for the coding agent (e.g. `claude`, `amp`, `codex`). */
  command: string
  /** Command-line arguments. */
  args?: string[]
  /** Working directory for the spawned agent. */
  cwd?: string
  /** Tool name the model calls. */
  name: string
  /** Tool description surfaced to the model. */
  description: string
  /**
   * REQUIRED — decide file/shell permission requests from the coding agent. Security by default:
   * there is NO default-allow. Return `{ granted: boolean }` (may be async).
   */
  onPermissionRequest: (params: unknown) => { granted: boolean } | Promise<{ granted: boolean }>
  /** Injected transport factory (defaults to spawning via {@link NodeAcpTransport}) — for tests. */
  transportFactory?: (config: AcpToolConfig) => AcpTransport
}

function defaultTransport(config: AcpToolConfig): AcpTransport {
  return new NodeAcpTransport(config.command, config.args, config.cwd)
}

/** Wrap a coding agent as a `CustomTool`. Fails fast if `onPermissionRequest` is missing. */
export function createACPTool(config: AcpToolConfig): CustomTool {
  if (typeof config.onPermissionRequest !== 'function') {
    throw new Error(
      '[theokit] createACPTool requires onPermissionRequest (security by default — no default-allow)',
    )
  }
  const makeTransport = config.transportFactory ?? defaultTransport
  return {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The task/prompt for the coding agent.' },
      },
      required: ['message'],
    },
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const message = typeof input.message === 'string' ? input.message : ''
      const client = new AcpClient(makeTransport(config))
      client.onRequest('session/request_permission', (params) => config.onPermissionRequest(params))
      const result = (await client.request('session/prompt', { message })) as { text?: string }
      return result.text ?? ''
    },
  }
}

// M56: the `encodeAcpMessage` re-export had no consumer — callers building custom transports
// import it from `@theokit/agents` directly, which is where it is defined.
