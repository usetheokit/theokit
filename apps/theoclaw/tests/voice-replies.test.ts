import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayRunner } from '@theokit/gateway'
import type { GatewayContext, MessageEvent } from '@theokit/gateway'
import { parseInbound, telegramChannel } from '@theokit/gateway-telegram'
import { composeTheoClaw } from '../src/composition.js'
import { fakeBuilders, noAgent, WORKSPACE } from './composition-fixtures.js'
import { processSecrets } from '../src/secrets.js'
import { channelHooks } from '../src/channel-hooks.js'
import { parseAuthorizationPolicy } from '../src/authorization/policy.js'
import { createReplyHandler } from '../src/channels/reply-handler.js'
import { configuredVoiceReplies, VOICE_FAILED, withVoiceReplies } from '../src/voice/voice-replies.js'
import { FakeAdapter, FakeAgent, assistant, finished, messageEvent, waitFor } from './fakes.js'

const env = { THEOCLAW_VOICE_OPENAI_API_KEY: 'audio-secret', THEOCLAW_TELEGRAM_TOKEN: 'telegram-secret' }
function note(sender = 1, bytes: Uint8Array = new TextEncoder().encode('OggS'), size?: number): MessageEvent {
  const event = parseInbound({ message: {
    message_id: sender + 2, date: 10, from: { id: sender }, chat: { id: 42, type: 'private' },
    voice: { file_id: 'voice-id', mime_type: 'audio/ogg' },
  } })
  if (!event) throw new Error('fixture did not parse')
  return { ...event, audio: { read: vi.fn(async () => bytes), ...(size === undefined ? {} : { size }), mediaType: 'audio/ogg', durationSeconds: 1 } }
}
function context(event: MessageEvent): GatewayContext {
  return { event, reply: vi.fn(async () => ({ ok: true })) }
}
/** A Telegram-like adapter that accepts audio attachments, which the plain fake refuses. */
class AudioAdapter extends FakeAdapter {
  override readonly supportsAttachments = true
  protected override readonly attachmentKinds = ['audio' as const]
}
function network() {
  return vi.fn<typeof fetch>(async (url) => {
    const path = String(url)
    if (path.endsWith('/transcriptions')) return Response.json({ text: 'hello from voice' })
    if (path.endsWith('/speech')) return new Response('OggS-reply')
    throw new Error(`unexpected request ${path}`)
  })
}

describe('voice note replies', () => {
  it('runs a parsed Telegram note through authorization, session, masking and audio delivery offline', async () => {
    const request = network()
    const agent = new FakeAgent({ frames: [assistant('Hello audio-secret'), finished()] })
    const release = vi.fn()
    const handler = createReplyHandler({
      reset: async () => undefined, secrets: ['audio-secret'],
      withAgent: async (_event, work) => work({ agent, release }),
    })
    const adapter = new AudioAdapter('telegram')
    const runner = new GatewayRunner({ adapters: [adapter],
      handler: withVoiceReplies(handler, configuredVoiceReplies(env, request)),
      hooks: channelHooks({ policy: parseAuthorizationPolicy({ THEOCLAW_OWNERS: 'telegram:1', THEOCLAW_DM_POLICY: 'allowlist' }), write: () => undefined }),
    })
    await runner.start()
    try {
      await adapter.deliver(note(2))
      await waitFor(() => adapter.sent.length === 1, 1000, 'denied sender reply')
      adapter.sent.length = 0
      expect(request).not.toHaveBeenCalled()
      await adapter.deliver(note())
      await waitFor(() => release.mock.calls.length === 1, 1000, 'voice turn completion')
      expect(agent.sent).toEqual(['hello from voice'])
      expect(release).toHaveBeenCalledOnce()
      expect(request).toHaveBeenCalledTimes(2)
      const speech = request.mock.calls[1]?.[1]
      expect(JSON.parse(String(speech?.body))).toEqual({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Hello [redacted]', response_format: 'mp3' })
      expect(adapter.sent).toHaveLength(1)
      const sent = adapter.sent[0]!
      expect(sent.text).toBe('Hello [redacted]')
      expect(sent.attachments).toHaveLength(1)
      const [audio] = sent.attachments!
      expect(audio).toMatchObject({ kind: 'audio', mediaType: 'audio/mpeg' })
      expect(new TextDecoder().decode(audio!.data)).toBe('OggS-reply')
      const transcription = request.mock.calls[0]?.[1]?.body as FormData
      expect((transcription.get('file') as File).name).toBe('voice.ogg')
      expect(transcription.get('model')).toBe('gpt-4o-mini-transcribe')
      expect(await (transcription.get('file') as Blob).text()).toBe('OggS')
    } finally { await runner.stop() }
  })

  it('enables voice from the real composition environment and masks its audio key', async () => {
    const request = network()
    vi.stubGlobal('fetch', request)
    const agent = new FakeAgent({ frames: [assistant('audio-secret'), finished()] })
    const { adapters, builders } = fakeBuilders()
    const app = composeTheoClaw({
      env: { ...env, THEOCLAW_WORKSPACE: WORKSPACE, THEOCLAW_MODEL: 'offline-model',
        OPENROUTER_API_KEY: 'chat-secret', THEOCLAW_OWNERS: 'telegram:1', THEOCLAW_DM_POLICY: 'allowlist' },
      builders, agentFactory: noAgent, getOrCreate: async () => Object.assign(agent, { dispose: async () => undefined }), write: () => undefined,
    })
    try {
      await app.loop.ready
      await adapters.get('telegram')!.deliver(note())
      await waitFor(() => request.mock.calls.some(([url]) => String(url).endsWith('/speech')), 2000, 'composed speech request')
      expect(agent.sent).toEqual(['hello from voice'])
      expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body)).input).toBe('[redacted]')
    } finally {
      await app.loop.stopAll()
      await app.sessions.disposeAll()
      vi.unstubAllGlobals()
    }
  })

  it('includes the audio credential in process-wide secret masking', () => {
    expect(processSecrets({ env }, { controlToken: undefined, webchatToken: undefined }, { secrets: [] }))
      .toContain('audio-secret')
  })

  it('passes ordinary text through with voice disabled', async () => {
    const handler = vi.fn(async () => undefined)
    const event = messageEvent('telegram', 'hello')
    const ctx = context(event)
    await withVoiceReplies(handler, undefined)(event, ctx)
    expect(handler).toHaveBeenCalledWith(event, ctx)
  })

  it.each(['disabled', 'failure', 'empty'])('answers %s transcription without starting an agent', async (failure) => {
    const handler = vi.fn(async () => undefined)
    const event = note()
    const ctx = context(event)
    const voice = failure === 'disabled' ? undefined : {
      transcribe: async () => { if (failure === 'failure') throw new Error('credential'); return '  ' },
      speak: vi.fn(async () => new Uint8Array([1])),
    }
    await withVoiceReplies(handler, voice)(event, ctx)
    expect(handler).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(VOICE_FAILED)
  })

  it('falls back to the masked text when speech fails and preserves delivery failures', async () => {
    const event = note()
    const ctx = context(event)
    const voice = { transcribe: async () => 'hello', speak: vi.fn(async (): Promise<Uint8Array> => { throw new Error('secret') }) }
    const result = { ok: false, error: { code: 'refused', message: 'refused' } }
    ctx.reply = vi.fn(async () => result)
    const handler = vi.fn(async (_event, inner: GatewayContext) => {
      expect(await inner.reply('safe answer', { format: 'plain' })).toEqual(result)
    })
    await withVoiceReplies(handler, voice)(event, ctx)
    expect(ctx.reply).toHaveBeenCalledWith('safe answer', { format: 'plain' })
    expect(voice.speak).toHaveBeenCalledOnce()
  })

  it('hands the handler the trimmed transcript as text and sends the reply as one audio attachment', async () => {
    const event = note()
    const ctx = context(event)
    const handler = vi.fn(async (inner: MessageEvent, innerCtx: GatewayContext) => { expect(inner.text).toBe('hello from voice'); await innerCtx.reply('answer') })
    await withVoiceReplies(handler, configuredVoiceReplies(env, network()))(event, ctx)
    expect(handler).toHaveBeenCalledOnce()
    expect(ctx.reply).toHaveBeenCalledExactlyOnceWith('answer', {
      attachments: [{ kind: 'audio', mediaType: 'audio/mpeg', data: new TextEncoder().encode('OggS-reply'), filename: 'reply.mp3' }],
    })
  })

  describe('the published Telegram adapter', () => {
    const voiceCtx = (getFile: ReturnType<typeof vi.fn>) => ({
      chat: { id: 42, type: 'private' }, from: { id: 1 }, getFile,
      message: { message_id: 3, date: 10, chat: { id: 42, type: 'private' }, from: { id: 1 }, voice: { file_id: 'voice-id', mime_type: 'audio/ogg' } },
    })
    async function dispatch(ownerOnly: boolean, sender: number) {
      const getFile = vi.fn(async () => ({ file_path: 'voice/a.ogg' }))
      const download = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
      vi.stubGlobal('fetch', download)
      const adapter = telegramChannel.create({ token: '123:abc' }) as unknown as {
        onInbound(h: (e: MessageEvent) => Promise<void>): () => void
        handleInbound(ctx: unknown): Promise<void>
      }
      const order: string[] = []
      adapter.onInbound(async (event) => {
        order.push('hook')
        if (ownerOnly && sender !== 1) return
        order.push('read')
        const audio = (event as { audio?: { read(): Promise<Uint8Array> } }).audio
        expect(await audio?.read()).toEqual(new Uint8Array([1, 2, 3]))
      })
      const ctx = voiceCtx(getFile)
      ctx.from.id = sender
      await adapter.handleInbound(ctx)
      return { getFile, download, order }
    }

    it('reads no audio for a sender the hooks reject', async () => {
      const { getFile, download, order } = await dispatch(true, 2)
      expect(order).toEqual(['hook'])
      expect(getFile).not.toHaveBeenCalled()
      expect(download).not.toHaveBeenCalled()
    })

    it('reads the audio only after the hooks accept the sender', async () => {
      const { getFile, download, order } = await dispatch(true, 1)
      expect(order).toEqual(['hook', 'read'])
      expect(getFile).toHaveBeenCalledOnce()
      expect(download).toHaveBeenCalledOnce()
    })

    afterEach(() => { vi.unstubAllGlobals() })
  })

  it('requires explicit audio and Telegram credentials', () => {
    expect(configuredVoiceReplies({})).toBeUndefined()
    expect(configuredVoiceReplies({ THEOCLAW_VOICE_OPENAI_API_KEY: 'key' })).toBeUndefined()
  })

  it.each(['http', 'oversize-size', 'oversize-bytes', 'empty', 'transcription'])('rejects invalid %s input before a model turn', async (failure) => {
    const request = network()
    if (failure === 'http') request.mockResolvedValueOnce(new Response('', { status: 401 }))
    if (failure === 'transcription') request.mockResolvedValueOnce(Response.json({ text: null }))
    const event = note(1, failure === 'empty' ? new Uint8Array() : failure === 'oversize-bytes' ? new Uint8Array(21 * 1024 * 1024) : undefined, failure === 'oversize-size' ? 21 * 1024 * 1024 : undefined)
    const handler = vi.fn(async () => undefined)
    const ctx = context(event)
    await withVoiceReplies(handler, configuredVoiceReplies(env, request))(event, ctx)
    expect(handler).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(VOICE_FAILED)
  })

  it.each(['speech-http', 'speech-empty', 'upload-refused', 'upload-timeout'])('falls back without retrying on %s', async (failure) => {
    const normal = network()
    const request = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/speech')) {
        if (failure === 'speech-http') return new Response('', { status: 503 })
        if (failure === 'speech-empty') return new Response('')
      }
      return normal(url, init)
    })
    const event = note()
    const ctx = context(event)
    if (failure.startsWith('upload')) {
      ctx.reply = vi.fn(async (_text, opts) => {
        if (opts?.attachments === undefined) return { ok: true }
        if (failure === 'upload-timeout') throw new Error('timeout')
        return { ok: false, error: { code: 'platform_error', message: 'refused' } }
      })
    }
    const handler = async (_event: MessageEvent, inner: GatewayContext): Promise<void> => { await inner.reply('safe answer') }
    await withVoiceReplies(handler, configuredVoiceReplies(env, request))(event, ctx)
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/speech'))).toHaveLength(1)
    const calls = vi.mocked(ctx.reply).mock.calls
    expect(calls.filter(([, opts]) => opts?.attachments !== undefined)).toHaveLength(failure.startsWith('speech') ? 0 : 1)
    expect(calls.at(-1)).toEqual(['safe answer', undefined])
  })

  it('does not send an overlong answer to TTS', async () => {
    const request = network()
    await expect(configuredVoiceReplies(env, request)!.speak('a'.repeat(4097))).rejects.toThrow('too long')
    expect(request).not.toHaveBeenCalled()
  })
})
