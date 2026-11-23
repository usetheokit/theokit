import type { GatewayHandler, MessageEvent } from '@theokit/gateway'

export interface VoiceReplies {
  transcribe(fileId: string): Promise<string>
  speak(event: MessageEvent, text: string): Promise<void>
}

const MAX_AUDIO_BYTES = 20 * 1024 * 1024
export const VOICE_FAILED = 'I could not process that voice note. Please send text instead.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Both grammy polling contexts and parsed webhook updates carry `message.voice`. */
function voiceId(event: MessageEvent): string | undefined {
  if (event.platform !== 'telegram') return undefined
  const raw = event.telegram.raw
  if (!record(raw) || !record(raw.message) || !record(raw.message.voice)) return undefined
  return typeof raw.message.voice.file_id === 'string' ? raw.message.voice.file_id : undefined
}

/** Runs inside the gateway handler, after owner and group authorization. */
export function withVoiceReplies(handler: GatewayHandler, voice: VoiceReplies | undefined): GatewayHandler {
  return async (event, ctx) => {
    const fileId = voiceId(event)
    if (fileId === undefined) return handler(event, ctx)
    let text: string
    try {
      if (voice === undefined) throw new Error('voice disabled')
      text = (await voice.transcribe(fileId)).trim()
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
    async transcribe(fileId) {
      const metadata = await json(await call(`${telegram}/getFile`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file_id: fileId }),
      }))
      const file = metadata.result
      if (metadata.ok !== true || !record(file) || typeof file.file_path !== 'string' ||
          !/^[\w/-]+\.\w+$/.test(file.file_path) || file.file_path.includes('..') ||
          (typeof file.file_size === 'number' && file.file_size > MAX_AUDIO_BYTES)) throw new Error('invalid voice file')
      const audio = await bytes(await call(`https://api.telegram.org/file/bot${token}/${file.file_path}`))
      const body = new FormData()
      body.set('file', new Blob([audio], { type: 'audio/ogg' }), 'voice.ogg')
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
