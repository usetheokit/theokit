// A local delivery target for scheduled jobs: a bounded, durable list under the workspace that a
// /control agent reads with `read_schedule_inbox`, so an instance with no chat platform can schedule.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { type CustomTool, Tool } from '@theokit/sdk'
import { z } from 'zod'

/** The platform name a job gives to deliver to the inbox; its channel id is free text (a label). */
export const INBOX_PLATFORM = 'inbox'
/** How many messages the inbox keeps; the oldest are dropped past it. */
export const INBOX_LIMIT = 100

export interface InboxMessage {
  readonly at: number
  readonly channelId: string
  readonly text: string
}

export function inboxFile(workspace: string): string {
  return join(workspace, '.theoclaw', 'schedule-inbox.json')
}

export class ScheduleInbox {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly file: string,
    private readonly mask: (text: string) => string = (text) => text,
  ) {}

  list(): InboxMessage[] {
    try {
      const data: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(data) ? (data as InboxMessage[]) : []
    } catch {
      return []
    }
  }

  /** Append one masked message; writes are serialized. Resolves false when the write failed. */
  add(channelId: string, text: string): Promise<boolean> {
    const run = this.tail.then(() => {
      try {
        const messages = [...this.list(), { at: Date.now(), channelId, text: this.mask(text) }]
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
        const temp = `${this.file}.tmp`
        writeFileSync(temp, JSON.stringify(messages.slice(-INBOX_LIMIT)), { mode: 0o600 })
        renameSync(temp, this.file)
        return true
      } catch {
        return false
      }
    })
    this.tail = run
    return run
  }
}

/** `read_schedule_inbox`: the stored messages, newest last. */
export function createInboxTool(inbox: ScheduleInbox): CustomTool {
  const inputSchema = z.object({
    limit: z.number().int().min(1).max(INBOX_LIMIT).optional().describe('How many of the newest messages to return.'),
    channelId: z.string().min(1).optional().describe('Only the messages sent to this label.'),
  })
  const handle = (raw: unknown): Promise<string> => {
    const { limit, channelId } = inputSchema.parse(raw)
    const all = inbox.list().filter((message) => channelId === undefined || message.channelId === channelId)
    return Promise.resolve(JSON.stringify({ messages: all.slice(-(limit ?? 20)) }))
  }
  return Tool.create({
    name: 'read_schedule_inbox',
    description:
      `Read the answers of scheduled jobs whose platform is "${INBOX_PLATFORM}" (kept locally, the last ${String(INBOX_LIMIT)}). ` +
      'Returns JSON: { messages: [{ at, channelId, text }] }.',
    inputSchema,
    handler: handle,
  })
}
