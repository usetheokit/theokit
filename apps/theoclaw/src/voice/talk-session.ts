/**
 * Continuous talk mode (OC-100) and wake word (OC-101), independent of any audio device.
 * The capture side segments speech into utterances and calls `hear`; transcription, the
 * chat turn and speech are injected, so no per-message send is needed between turns.
 */
export interface TalkDeps {
  transcribe(utterance: Uint8Array): Promise<string>
  turn(text: string): Promise<string>
  speak(text: string): Promise<void>
  /** When set, an idle session only reacts to utterances that start with this phrase. */
  wakeWord?: string
  /** How long the session stays awake after the last turn. Default 30s. */
  awakeMs?: number
  now?: () => number
}

export type TalkOutcome = 'ignored' | 'replied' | 'empty'

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/** Returns the text after a leading wake word, or undefined when the word is absent. */
export function stripWakeWord(transcript: string, wakeWord: string): string | undefined {
  const wake = normalize(wakeWord)
  if (wake === '') return undefined
  const text = normalize(transcript)
  if (text === wake) return ''
  return text.startsWith(`${wake} `) ? text.slice(wake.length + 1) : undefined
}

export interface TalkSession {
  hear(utterance: Uint8Array): Promise<TalkOutcome>
}

export function createTalkSession(deps: TalkDeps): TalkSession {
  const now = deps.now ?? Date.now
  const awakeMs = deps.awakeMs ?? 30_000
  let awakeUntil = 0
  let queue: Promise<unknown> = Promise.resolve()

  async function handle(utterance: Uint8Array): Promise<TalkOutcome> {
    const transcript = (await deps.transcribe(utterance)).trim()
    let text = transcript
    const awake = now() < awakeUntil
    if (deps.wakeWord !== undefined && !awake) {
      const rest = stripWakeWord(transcript, deps.wakeWord)
      if (rest === undefined) return 'ignored'
      text = rest
    }
    awakeUntil = now() + awakeMs
    if (text === '') return 'empty'
    await deps.speak(await deps.turn(text))
    awakeUntil = now() + awakeMs
    return 'replied'
  }

  return {
    // Utterances are handled strictly in order so spoken turns never overlap.
    hear(utterance) {
      const next = queue.then(() => handle(utterance))
      queue = next.catch(() => undefined)
      return next
    },
  }
}
