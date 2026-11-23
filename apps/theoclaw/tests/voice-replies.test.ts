import { describe, expect, it, vi } from 'vitest'
import { GatewayRunner } from '@theokit/gateway'
import type { GatewayContext, MessageEvent } from '@theokit/gateway'
import { parseInbound } from '@theokit/gateway-telegram'
import { composeTheoClaw } from '../src/composition.js'
import { fakeBuilders, noAgent, WORKSPACE } from './composition-fixtures.js'
import { processSecrets } from '../src/secrets.js'
import { channelHooks } from '../src/channel-hooks.js'
import { parseAuthorizationPolicy } from '../src/authorization/policy.js'
import { createReplyHandler } from '../src/channels/reply-handler.js'
import { configuredVoiceReplies, VOICE_FAILED, withVoiceReplies } from '../src/voice/voice-replies.js'
import { FakeAdapter, FakeAgent, assistant, finished, messageEvent, waitFor } from './fakes.js'

const env = { THEOCLAW_VOICE_OPENAI_API_KEY: 'audio-secret', THEOCLAW_TELEGRAM_TOKEN: 'telegram-secret' }
function note(sender = 1): MessageEvent {
  const event = parseInbound({ message: {
    message_id: sender + 2, date: 10, from: { id: sender }, chat: { id: 42, type: 'private' },
    voice: { file_id: 'voice-id', mime_type: 'audio/ogg' },
  } })
  if (!event) throw new Error('fixture did not parse')
  return event
}
function context(event: MessageEvent): GatewayContext {
  return { event, reply: vi.fn(async () => ({ ok: true })) }
}
function network() {
  return vi.fn<typeof fetch>(async (url) => {
    const path = String(url)
    if (path.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'voice/file.oga', file_size: 4 } })
    if (path.includes('/file/bot')) return new Response('OggS')
    if (path.endsWith('/transcriptions')) return Response.json({ text: 'hello from voice' })
    if (path.endsWith('/speech')) return new Response('OggS-reply')
    if (path.endsWith('/sendVoice')) return Response.json({ ok: true, result: { message_id: 4 } })
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
    const adapter = new FakeAdapter('telegram')
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
      expect(adapter.sent).toEqual([])
      expect(request).toHaveBeenCalledTimes(5)
      const speech = request.mock.calls[3]?.[1]
      expect(JSON.parse(String(speech?.body))).toEqual({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Hello [redacted]', response_format: 'opus' })
      const upload = request.mock.calls[4]?.[1]?.body as FormData
      expect(upload.get('chat_id')).toBe('42')
      expect(upload.get('reply_parameters')).toBe('{"message_id":3}')
      expect(await (upload.get('voice') as Blob).text()).toBe('OggS-reply')
      const transcription = request.mock.calls[2]?.[1]?.body as FormData
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
      await waitFor(() => request.mock.calls.some(([url]) => String(url).endsWith('/sendVoice')), 2000, 'composed audio reply')
      expect(agent.sent).toEqual(['hello from voice'])
      expect(JSON.parse(String(request.mock.calls[3]?.[1]?.body)).input).toBe('[redacted]')
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
      speak: vi.fn(),
    }
    await withVoiceReplies(handler, voice)(event, ctx)
    expect(handler).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(VOICE_FAILED)
  })

  it('falls back to the masked text when speech fails and preserves delivery failures', async () => {
    const event = note()
    const ctx = context(event)
    const voice = { transcribe: async () => 'hello', speak: vi.fn(async () => { throw new Error('secret') }) }
    const result = { ok: false, error: { code: 'refused', message: 'refused' } }
    ctx.reply = vi.fn(async () => result)
    const handler = vi.fn(async (_event, inner: GatewayContext) => {
      expect(await inner.reply('safe answer', { format: 'plain' })).toEqual(result)
    })
    await withVoiceReplies(handler, voice)(event, ctx)
    expect(ctx.reply).toHaveBeenCalledWith('safe answer', { format: 'plain' })
    expect(voice.speak).toHaveBeenCalledOnce()
  })

  it('accepts grammy context message getters and keeps thread routing', async () => {
    const request = network()
    const base = note()
    if (base.platform !== 'telegram') throw new Error('fixture')
    const event = { ...base, channel: { ...base.channel, type: 'thread' as const, topicId: '7' },
      telegram: { ...base.telegram, raw: { get message() { return { voice: { file_id: 'voice-id' } } } } } }
    const handler = vi.fn(async (_event, ctx: GatewayContext) => { await ctx.reply('answer') })
    await withVoiceReplies(handler, configuredVoiceReplies(env, request))(event, context(event))
    expect((request.mock.calls[4]?.[1]?.body as FormData).get('message_thread_id')).toBe('7')
  })

  it('requires explicit audio and Telegram credentials', () => {
    expect(configuredVoiceReplies({})).toBeUndefined()
    expect(configuredVoiceReplies({ THEOCLAW_VOICE_OPENAI_API_KEY: 'key' })).toBeUndefined()
  })

  it.each(['http', 'api', 'path', 'oversize', 'stream', 'empty', 'transcription'])('rejects invalid %s input before a model turn', async (failure) => {
    const request = network()
    if (failure === 'http') request.mockResolvedValueOnce(new Response('', { status: 401 }))
    if (failure === 'api') request.mockResolvedValueOnce(Response.json({ ok: false }))
    if (failure === 'path') request.mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: '../secret.ogg' } }))
    if (failure === 'oversize') request.mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: 'voice/a.ogg', file_size: 21 * 1024 * 1024 } }))
    if (['stream', 'empty', 'transcription'].includes(failure)) {
      request.mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: 'voice/a.ogg' } }))
      request.mockResolvedValueOnce(new Response(failure === 'stream' ? new Uint8Array(21 * 1024 * 1024) : failure === 'empty' ? '' : 'audio'))
      if (failure === 'transcription') request.mockResolvedValueOnce(Response.json({ text: null }))
    }
    const handler = vi.fn(async () => undefined)
    const event = note()
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
      if (String(url).endsWith('/sendVoice')) {
        if (failure === 'upload-refused') return Response.json({ ok: false })
        if (failure === 'upload-timeout') throw new Error('timeout')
      }
      return normal(url, init)
    })
    const event = note()
    const ctx = context(event)
    const handler = async (_event: MessageEvent, inner: GatewayContext): Promise<void> => { await inner.reply('safe answer') }
    await withVoiceReplies(handler, configuredVoiceReplies(env, request))(event, ctx)
    expect(ctx.reply).toHaveBeenCalledExactlyOnceWith('safe answer', undefined)
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/speech'))).toHaveLength(1)
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/sendVoice')))
      .toHaveLength(failure.startsWith('speech') ? 0 : 1)
  })

  it('does not send an overlong answer to TTS', async () => {
    const request = network()
    await expect(configuredVoiceReplies(env, request)!.speak(note(), 'a'.repeat(4097))).rejects.toThrow('too long')
    expect(request).not.toHaveBeenCalled()
  })
})
