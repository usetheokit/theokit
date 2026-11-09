import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * OC-55 (B-379): the persona files of a workspace, injected into a chat agent's system prompt.
 * HEARTBEAT.md is left out: it steers the heartbeat run, not a conversation.
 */
export const PERSONA_FILES = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'AGENTS.md'] as const

/** One file is cut at this many characters, so a runaway file cannot fill the context. */
export const PERSONA_FILE_LIMIT = 20_000

/** The persona section for `workspace`: each present, non-empty file under its own heading; '' when none. */
export function readPersonaPrompt(workspace: string): string {
  const parts: string[] = []
  for (const name of PERSONA_FILES) {
    let text: string
    try {
      text = readFileSync(join(workspace, name), 'utf8').trim()
    } catch {
      continue
    }
    if (text === '') continue
    const body = text.length > PERSONA_FILE_LIMIT ? `${text.slice(0, PERSONA_FILE_LIMIT)}\n[truncated]` : text
    parts.push(`## ${name}\n\n${body}`)
  }
  return parts.join('\n\n')
}
