import type { GatewayHandler, InboundAudio, MessageEvent } from '@theokit/gateway'

export interface VoiceReplies {
  /** The audio the Telegram adapter read: bounded to 20 MB and 30 s by the adapter, before any authorization hook runs. */
  transcribe(audio: InboundAudio): Promise<string>
  speak(event: MessageEvent, text: string): Promise<void>
}

const MAX_AUDIO_BYTES = 20 * 1024 * 1024
export const VOICE_FAILED = 'I could not process that voice note. Please send text instead.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Whether a Telegram message is a voice note. Both grammy polling contexts and parsed webhook
 * updates carry `message.voice`; the adapter adds `event.audio` when it could read the audio, so a
 * voice note without it is one it could not read.
 */
function isVoiceNote(event: MessageEvent): boolean {
  if (event.platform !== 'telegram') return false
  const raw = event.telegram.raw
  return record(raw) && record(raw.message) && record(raw.message.voice)
}

/** Runs inside the gateway handler, after owner and group authorization. */
export function withVoiceReplies(handler: GatewayHandler, voice: VoiceReplies | undefined): GatewayHandler {
  return async (event, ctx) => {
    if (!isVoiceNote(event)) return handler(event, ctx)
    let text: string
    try {
      if (voice === undefined) throw new Error('voice disabled')
      if (event.audio === undefined) throw new Error('voice not read')
      text = (await voice.transcribe(event.audio)).trim()
      if (text === '') throw new Error('empty transcription')
    } catch {
      await ctx.reply(VOICE_FAILED)
      return
    }
    const transcribed = { ...event, text }
    await handler(transcribed, {
      event: transcribed,
      reply: async (answer, opts) => {
        try {
          await voice!.speak(event, answer)
          return { ok: true }
        } catch {
          // Do not retry an audio upload: the platform may have accepted it before a timeout.
          return ctx.reply(answer, opts)
        }
      },
    })
  }
}

/** Read a bounded stream even when the server omits or lies about Content-Length. */
async function bytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || response.body === null) throw new Error('audio request failed')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_AUDIO_BYTES) throw new Error('audio too large')
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel()
  }
  if (size === 0) throw new Error('empty audio')
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

/** Opt in with a separate audio credential; the chat model remains THEOCLAW_MODEL. */
export function configuredVoiceReplies(
  env: Readonly<Record<string, string | undefined>>,
  request: typeof fetch = fetch,
): VoiceReplies | undefined {
  const key = env.THEOCLAW_VOICE_OPENAI_API_KEY?.trim()
  const token = env.THEOCLAW_TELEGRAM_TOKEN?.trim()
  if (!key || !token) return undefined
  const telegram = `https://api.telegram.org/bot${token}`
  const call = (url: string, init?: RequestInit): Promise<Response> => request(url, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(60_000),
  })
  const json = async (response: Response): Promise<Record<string, unknown>> => {
    if (!response.ok) throw new Error('voice request failed')
    const value: unknown = await response.json()
    if (!record(value)) throw new Error('invalid voice response')
    return value
  }
  return {
    async transcribe(audio) {
      const body = new FormData()
      body.set('file', new Blob([audio.data as Uint8Array<ArrayBuffer>], { type: audio.mediaType }), 'voice.ogg')
      body.set('model', 'gpt-4o-mini-transcribe')
      const result = await json(await call('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { authorization: `Bearer ${key}` }, body,
      }))
      if (typeof result.text !== 'string') throw new Error('invalid transcription')
      return result.text
    },
    async speak(event, text) {
      if (text.length > 4096) throw new Error('answer too long for speech')
      const audio = await bytes(await call('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'opus' }),
      }))
      const body = new FormData()
      body.set('chat_id', event.channel.id)
      if (event.channel.topicId !== undefined) body.set('message_thread_id', event.channel.topicId)
      body.set('reply_parameters', JSON.stringify({ message_id: event.platform === 'telegram' ? event.telegram.messageId : event.id }))
      body.set('caption', 'AI-generated voice')
      body.set('voice', new Blob([audio], { type: 'audio/ogg' }), 'reply.ogg')
      const result = await json(await call(`${telegram}/sendVoice`, { method: 'POST', body }))
      if (result.ok !== true) throw new Error('voice delivery failed')
    },
  }
}
