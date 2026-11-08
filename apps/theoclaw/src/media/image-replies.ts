import type { GatewayHandler, MessageEvent } from '@theokit/gateway'

import { generateImage, MediaGenerationError } from './generation.js'
import type { GeneratedImage, ImageGenerationConfig } from './generation.js'

/** The gateway reply is text-only, so a picture goes out through the platform's own API (as voice does). */
export interface ImageReplies {
  generate(prompt: string): Promise<GeneratedImage>
  send(event: MessageEvent, image: GeneratedImage, caption: string): Promise<void>
}

export const IMAGE_COMMAND = /^\/image(?:\s+([\s\S]+))?$/
export const IMAGE_USAGE = 'Usage: /image <description of the picture>'
export const IMAGE_UNAVAILABLE = 'Image generation is not available here.'
export const IMAGE_FAILED = 'Image generation failed. Please try again later.'
const FAILURES: Record<string, string> = {
  insufficient_credit: 'Image generation failed: the image provider account has no credit left.',
  unknown_model: 'Image generation failed: the configured image model does not exist.',
}

/** `/image <prompt>` turns generate a picture and deliver it as the turn's reply; other turns pass through. */
export function withImageReplies(handler: GatewayHandler, images: ImageReplies | undefined): GatewayHandler {
  return async (event, ctx) => {
    const match = IMAGE_COMMAND.exec(event.text.trim())
    if (match === null) return handler(event, ctx)
    const prompt = match[1]?.trim() ?? ''
    if (prompt === '') {
      await ctx.reply(IMAGE_USAGE)
      return
    }
    if (images === undefined || event.platform !== 'telegram') {
      await ctx.reply(IMAGE_UNAVAILABLE)
      return
    }
    try {
      const image = await images.generate(prompt)
      await images.send(event, image, 'AI-generated image')
    } catch (error) {
      await ctx.reply(error instanceof MediaGenerationError ? (FAILURES[error.code] ?? IMAGE_FAILED) : IMAGE_FAILED)
    }
  }
}

/** Opt in with an OpenRouter key and the Telegram token; THEOCLAW_IMAGE_MODEL and _BASE_URL are optional. */
export function configuredImageReplies(
  env: Readonly<Record<string, string | undefined>>,
  request: typeof fetch = fetch,
  telegramBase = 'https://api.telegram.org',
): ImageReplies | undefined {
  const apiKey = env.THEOCLAW_IMAGE_OPENROUTER_API_KEY?.trim()
  const token = env.THEOCLAW_TELEGRAM_TOKEN?.trim()
  if (!apiKey || !token) return undefined
  const baseUrl = env.THEOCLAW_IMAGE_BASE_URL?.trim()
  const model = env.THEOCLAW_IMAGE_MODEL?.trim()
  const config: ImageGenerationConfig = {
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
  }
  return {
    generate: (prompt) => generateImage(prompt, config, request),
    async send(event, image, caption) {
      const body = new FormData()
      body.set('chat_id', event.channel.id)
      if (event.channel.topicId !== undefined) body.set('message_thread_id', event.channel.topicId)
      body.set('reply_parameters', JSON.stringify({ message_id: event.platform === 'telegram' ? event.telegram.messageId : event.id }))
      body.set('caption', caption)
      body.set('photo', new Blob([image.data], { type: image.mime }), 'image.png')
      const response = await request(`${telegramBase}/bot${token}/sendPhoto`, {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(60_000),
      })
      const result: unknown = response.ok ? await response.json() : undefined
      if (typeof result !== 'object' || result === null || (result as { ok?: unknown }).ok !== true) {
        throw new Error('image delivery failed')
      }
    },
  }
}
