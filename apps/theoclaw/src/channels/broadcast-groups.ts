/**
 * Broadcast groups (OC-21, FR-008): channels on several platforms that share one agent thread. The
 * member list is typed here, not imported from the authorization policy, which has the same shape:
 * `src/channels/` never imports `src/authorization/` (`.dependency-cruiser.cjs`).
 */
export interface BroadcastGroupConfig {
  readonly name: string
  readonly members: ReadonlyArray<{ readonly platform: string; readonly channelId: string }>
}

export interface TranscriptTurn {
  readonly role: 'user' | 'assistant'
  readonly platform: string
  readonly text: string
}

export interface BroadcastGroup {
  readonly name: string
  readonly members: BroadcastGroupConfig['members']
  /** The bounded thread, oldest first: at most 20 turns and 16 384 characters (NFR-003). */
  transcript(): readonly TranscriptTurn[]
  /** The prompt of a new message: the thread so far, then the message; the message alone when empty. */
  prompt(text: string): string
  /** Append one completed exchange, then drop the oldest turns past either bound. */
  record(platform: string, userText: string, assistantText: string): void
  /** Run `work` after every earlier turn of this group settled, so turns never interleave. */
  run<T>(work: () => Promise<T>): Promise<T>
}

export interface BroadcastGroups {
  groupOf(platform: string, channelId: string): BroadcastGroup | undefined
}

const MAX_TURNS = 20
const MAX_CHARACTERS = 16_384

function line(turn: TranscriptTurn): string {
  return `${turn.role === 'user' ? 'User' : 'Assistant'} (${turn.platform}): ${turn.text}`
}

function createGroup(config: BroadcastGroupConfig): BroadcastGroup {
  const turns: TranscriptTurn[] = []
  let characters = 0
  let tail: Promise<unknown> = Promise.resolve()

  const dropOldest = (): void => {
    while (turns.length > MAX_TURNS || characters > MAX_CHARACTERS) {
      characters -= turns.shift()?.text.length ?? 0
    }
  }

  return {
    name: config.name,
    members: config.members,
    transcript: () => [...turns],
    prompt: (text) =>
      turns.length === 0 ? text : `Earlier in this conversation:\n${turns.map(line).join('\n')}\n\nNow: ${text}`,
    record(platform, userText, assistantText) {
      turns.push({ role: 'user', platform, text: userText }, { role: 'assistant', platform, text: assistantText })
      characters += userText.length + assistantText.length
      dropOldest()
    },
    run(work) {
      const next = tail.then(work)
      // A failed turn must not stop the group's later turns from running.
      tail = next.catch(() => undefined)
      return next
    },
  }
}

/** Index the configured groups by `platform:channelId`; a channel belongs to at most one (EC-7). */
export function createBroadcastGroups(configs: readonly BroadcastGroupConfig[]): BroadcastGroups {
  const byChannel = new Map<string, BroadcastGroup>()
  for (const config of configs) {
    const group = createGroup(config)
    for (const member of config.members) byChannel.set(`${member.platform}:${member.channelId}`, group)
  }
  return { groupOf: (platform, channelId) => byChannel.get(`${platform}:${channelId}`) }
}
