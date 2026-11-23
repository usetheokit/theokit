import { describe, expect, it, vi } from 'vitest'
import { describeImage, transcribeAudio, withMediaContext } from '../src/media/understanding.js'

const config = { apiKey: 'k', baseUrl: 'https://media.test/v1/' }
const bytes = new Uint8Array([1, 2, 3])

function network() {
  return vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url)
    if (path === 'https://media.test/v1/audio/transcriptions') {
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer k')
      return Response.json({ text: ' the quick brown fox ' })
    }
    if (path === 'https://media.test/v1/chat/completions') {
      expect(String(init?.body)).toContain('data:image/png;base64,AQID')
      return Response.json({ choices: [{ message: { content: 'A red bicycle.' } }] })
    }
    throw new Error(`unexpected ${path}`)
  })
}

describe('media understanding', () => {
  it('transcribes audio and describes an image', async () => {
    const request = network()
    expect(await transcribeAudio(bytes, 'audio/ogg', config, request)).toBe('the quick brown fox')
    expect(await describeImage(bytes, 'image/png', config, request)).toBe('A red bicycle.')
  })

  it('folds understanding into the turn text and names what failed', async () => {
    const text = await withMediaContext('hi', [
      { mime: 'audio/ogg', data: bytes }, { mime: 'image/png', data: bytes }, { mime: 'video/mp4', data: bytes },
    ], config, network())
    expect(text).toBe('hi\n[Audio transcript: the quick brown fox]\n[Image description: A red bicycle.]\n[Attachment of type video/mp4 not understood]')
    const failed = await withMediaContext('', [{ mime: 'audio/ogg', data: bytes }], config, vi.fn<typeof fetch>(async () => new Response('', { status: 500 })))
    expect(failed).toBe('[Attachment of type audio/ogg could not be understood]')
  })

  it('rejects empty and non-image input', async () => {
    await expect(transcribeAudio(new Uint8Array(0), 'audio/ogg', config, network())).rejects.toThrow('empty media')
    await expect(describeImage(bytes, 'audio/ogg', config, network())).rejects.toThrow('not an image')
  })
})
