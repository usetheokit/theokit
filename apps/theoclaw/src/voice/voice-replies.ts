import { handleSttRequest, handleTtsRequest } from '@theokit/plugin-voice'
import type { GatewayHandler, InboundAudio } from '@theokit/gateway'

export interface VoiceReplies {
  transcribe(audio: InboundAudio): Promise<string>
  /** The synthesized speech, as `audio/mpeg` bytes. */
  speak(text: string): Promise<Uint8Array>
}

const TIMEOUT_MS = 60_000
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const SPEECH_MEDIA_TYPE = 'audio/mpeg'
export const VOICE_FAILED = 'I could not process that voice note. Please send text instead.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Runs inside the gateway handler, after owner and group authorization. */
export function withVoiceReplies(handler: GatewayHandler, voice: VoiceReplies | undefined): GatewayHandler {
  return async (event, ctx) => {
    const audio = event.audio
    if (audio === undefined) return handler(event, ctx)
    let text: string
    try {
      if (voice === undefined) throw new Error('voice disabled')
      text = (await voice.transcribe(audio)).trim()
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
          const data = await voice!.speak(answer)
          const sent = await ctx.reply(answer, { attachments: [{ kind: 'audio', mediaType: SPEECH_MEDIA_TYPE, data, filename: 'reply.mp3' }] })
          if (sent.ok) return sent
        } catch {
          // fall through to text
        }
        // Do not retry an audio upload: the platform may have accepted it before a timeout.
        return ctx.reply(answer, opts)
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
  const call = (url: string | URL, init?: RequestInit): Promise<Response> => request(url, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return {
    async transcribe(audio) {
      if (audio.size !== undefined && audio.size > MAX_AUDIO_BYTES) throw new Error('audio too large')
      const buffer = await audio.read()
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_AUDIO_BYTES) throw new Error('invalid audio size')
      const response = await handleSttRequest(
        { audio: { buffer, mimeType: audio.mediaType, filename: 'voice.ogg' } },
        { provider: 'openai', apiKey: key, model: 'gpt-4o-mini-transcribe', endpoint: '/' },
        { fetchImpl: call, timeoutMs: TIMEOUT_MS },
      )
      if (!response.ok) throw new Error('voice request failed')
      const result: unknown = await response.json()
      if (!record(result) || typeof result.transcript !== 'string') throw new Error('invalid transcription')
      return result.transcript
    },
    async speak(text) {
      if (text.length > 4096) throw new Error('answer too long for speech')
      return bytes(await handleTtsRequest(
        { text, voice: 'alloy' },
        { provider: 'openai', apiKey: key, model: 'gpt-4o-mini-tts', voice: 'alloy', endpoint: '/' },
        { fetchImpl: call, timeoutMs: TIMEOUT_MS },
      ))
    },
  }
}
