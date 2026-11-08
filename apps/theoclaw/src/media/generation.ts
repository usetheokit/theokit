/**
 * Image generation (B-385, OC-64) through OpenRouter's chat-completions image output: the image
 * comes back as `choices[0].message.images[].image_url.url`, a base64 `data:image/...` URL.
 * Video and music generation are not built (recorded as out in the parity ledger).
 */
export interface ImageGenerationConfig {
  readonly apiKey: string
  /** Defaults to https://openrouter.ai/api/v1 */
  readonly baseUrl?: string
  readonly model?: string
}

export interface GeneratedImage {
  readonly mime: string
  readonly data: Uint8Array<ArrayBuffer>
}

export type MediaGenerationErrorCode = 'insufficient_credit' | 'unknown_model' | 'request_failed' | 'invalid_response'

/** A refused or malformed generation. Carries a code, never the provider's body or the key. */
export class MediaGenerationError extends Error {
  readonly code: MediaGenerationErrorCode
  constructor(code: MediaGenerationErrorCode, options?: ErrorOptions) {
    super(`image generation failed (${code})`, options)
    this.name = 'MediaGenerationError'
    this.code = code
  }
}

export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function generateImage(
  prompt: string, config: ImageGenerationConfig, request: typeof fetch = fetch,
): Promise<GeneratedImage> {
  if (prompt.trim() === '') throw new MediaGenerationError('request_failed')
  const base = (config.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
  let response: Response
  try {
    response = await request(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model ?? DEFAULT_IMAGE_MODEL,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: prompt }],
      }),
      redirect: 'error', signal: AbortSignal.timeout(120_000),
    })
  } catch (cause) {
    throw new MediaGenerationError('request_failed', { cause })
  }
  if (response.status === 402) throw new MediaGenerationError('insufficient_credit')
  if (response.status === 404) throw new MediaGenerationError('unknown_model')
  if (!response.ok) throw new MediaGenerationError('request_failed')
  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    throw new MediaGenerationError('invalid_response', { cause })
  }
  const choice = record(body) && Array.isArray(body.choices) ? body.choices[0] : undefined
  const message = record(choice) ? choice.message : undefined
  const images = record(message) && Array.isArray(message.images) ? message.images : []
  const first: unknown = images[0]
  const image = record(first) ? first.image_url : undefined
  const url = record(image) ? image.url : undefined
  const match = typeof url === 'string' ? /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url) : null
  if (match === null) throw new MediaGenerationError('invalid_response')
  const data = new Uint8Array(Buffer.from(match[2]!, 'base64'))
  if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) throw new MediaGenerationError('invalid_response')
  return { mime: match[1]!, data }
}
