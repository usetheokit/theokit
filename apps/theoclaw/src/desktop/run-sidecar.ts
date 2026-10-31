import { randomUUID } from 'node:crypto'

import { type AgentStreamEvent, presentUIMessageStream } from '@theokit/agents/bridge'

import { type ControlClient, type ControlFrame, createControlClient } from '../control-client/control-client.js'
import { type ControlClientSettings, readControlClientSettings } from '../control-client/settings.js'
import { TheoClawConfigError } from '../control-plane/errors.js'

export interface SidecarIo {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  /** One JSONL line per call, newline included. */
  readonly stdout: (line: string) => void
}

/** The one error chunk the desktop webview reads as a failed turn. */
function errorLine(io: SidecarIo, errorText: string): number {
  io.stdout(`${JSON.stringify({ type: 'error', errorText })}\n`)
  return 1
}

/** The turn's events, from its frames; `ending` records how the turn ended. */
async function* eventsOf(
  frames: AsyncIterable<ControlFrame>,
  ending: { code?: string },
): AsyncGenerator<AgentStreamEvent> {
  for await (const frame of frames) {
    if (frame.type === 'event') yield frame.event as AgentStreamEvent
    else if (frame.type === 'error') ending.code = frame.code
  }
}

async function forward(client: ControlClient, message: string, settings: ControlClientSettings, io: SidecarIo): Promise<number> {
  const ending: { code?: string } = {}
  const events = eventsOf(client.chat(message, settings.session), ending)
  // A failed turn's detail stays on the instance; the webview gets its code only.
  for await (const chunk of presentUIMessageStream(events, { textId: randomUUID(), onError: (error) => error.code ?? 'turn_failed' })) {
    if (chunk.type === 'error') continue
    io.stdout(`${JSON.stringify(chunk)}\n`)
  }
  return ending.code === undefined ? 0 : errorLine(io, ending.code)
}

/**
 * The desktop sidecar (FR-010, plan D4): the Tauri shell spawns it per turn with the message as
 * argv[2] and reads UI message chunks, one JSON line each, from stdout. It forwards the turn to the
 * running instance on `THEOCLAW_SESSION` and builds no agent; killing it closes its socket, which
 * cancels the turn there. Resolves the exit code: 0 for a turn that finished or was interrupted, 1
 * with one error line otherwise.
 */
export async function runDesktopSidecar(io: SidecarIo): Promise<number> {
  const message = io.argv[2] ?? ''
  if (message.trim() === '') return errorLine(io, 'empty_message')
  let settings: ControlClientSettings
  try {
    settings = readControlClientSettings(io.env)
  } catch (error) {
    if (error instanceof TheoClawConfigError) return errorLine(io, error.variable ?? 'bad_settings')
    throw error
  }
  let client: ControlClient
  try {
    client = await createControlClient(settings)
  } catch {
    // The reason names the address or the HTTP status; the shell gets a stable code.
    return errorLine(io, 'connect_failed')
  }
  try {
    return await forward(client, message, settings, io)
  } catch {
    return errorLine(io, 'connection_closed')
  } finally {
    await client.close()
  }
}
