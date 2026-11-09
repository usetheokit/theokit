/**
 * Media understanding (B-402, OC-103/OC-104): audio is transcribed and an image is described by
 * OpenAI-compatible endpoints, and the result is folded into the turn's text as context.
 * Video, PDF and link understanding are not built.
 */
export interface MediaUnderstandingConfig {
  readonly apiKey: string
  /** Defaults to https://api.openai.com/v1 */
  readonly baseUrl?: string
  readonly transcriptionModel?: string
  readonly visionModel?: string
}

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function base(config: MediaUnderstandingConfig): string {
  return (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
}

function check(data: Uint8Array): void {
  if (data.byteLength === 0) throw new Error('empty media')
  if (data.byteLength > MAX_MEDIA_BYTES) throw new Error('media too large')
}

async function json(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`media request failed (${response.status})`)
  const value: unknown = await response.json()
  if (!record(value)) throw new Error('invalid media response')
  return value
}

export async function transcribeAudio(
  data: Uint8Array<ArrayBuffer>, mime: string, config: MediaUnderstandingConfig, request: typeof fetch = fetch,
): Promise<string> {
  check(data)
  const body = new FormData()
  body.set('file', new Blob([data], { type: mime }), `audio.${mime.split('/')[1]?.replace(/[^\w]/g, '') || 'bin'}`)
  body.set('model', config.transcriptionModel ?? 'gpt-4o-mini-transcribe')
  const result = await json(await request(`${base(config)}/audio/transcriptions`, {
    method: 'POST', headers: { authorization: `Bearer ${config.apiKey}` }, body,
    redirect: 'error', signal: AbortSignal.timeout(60_000),
  }))
  if (typeof result.text !== 'string' || result.text.trim() === '') throw new Error('invalid transcription')
  return result.text.trim()
}

export async function describeImage(
  data: Uint8Array, mime: string, config: MediaUnderstandingConfig, request: typeof fetch = fetch,
): Promise<string> {
  check(data)
  if (!mime.startsWith('image/')) throw new Error('not an image')
  const url = `data:${mime};base64,${Buffer.from(data).toString('base64')}`
  const result = await json(await request(`${base(config)}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.visionModel ?? 'gpt-4o-mini',
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Describe this image briefly. Name the main object or objects in it.' },
        { type: 'image_url', image_url: { url } },
      ] }],
    }),
    redirect: 'error', signal: AbortSignal.timeout(60_000),
  }))
  const choice = Array.isArray(result.choices) ? result.choices[0] : undefined
  const message = record(choice) ? choice.message : undefined
  const content = record(message) ? message.content : undefined
  if (typeof content !== 'string' || content.trim() === '') throw new Error('invalid description')
  return content.trim()
}

export interface MediaAttachment {
  readonly mime: string
  readonly data: Uint8Array<ArrayBuffer>
}

/** The turn text with each attachment's understanding appended; a failed one is named, not hidden. */
export async function withMediaContext(
  text: string, attachments: readonly MediaAttachment[], config: MediaUnderstandingConfig, request: typeof fetch = fetch,
): Promise<string> {
  const parts: string[] = text === '' ? [] : [text]
  for (const item of attachments) {
    try {
      if (item.mime.startsWith('audio/')) parts.push(`[Audio transcript: ${await transcribeAudio(item.data, item.mime, config, request)}]`)
      else if (item.mime.startsWith('image/')) parts.push(`[Image description: ${await describeImage(item.data, item.mime, config, request)}]`)
      else parts.push(`[Attachment of type ${item.mime.replace(/[^\w/.+-]/g, '')} not understood]`)
    } catch {
      parts.push(`[Attachment of type ${item.mime.replace(/[^\w/.+-]/g, '')} could not be understood]`)
    }
  }
  return parts.join('\n')
}
