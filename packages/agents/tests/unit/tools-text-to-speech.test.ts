/**
 * #1411 — the text-to-speech factory crosses the `@theokit/agents/tools` seam and works offline
 * against an injected provider.
 */
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createTextToSpeechTool, type TextToSpeechResult } from '../../src/tools-entry.js'

describe('createTextToSpeechTool through the tools subpath', () => {
  it('test_synthesizes_with_an_injected_provider_and_writes_the_clip', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'theokit-tts-'))
    const bytes = new Uint8Array([1, 2, 3, 4])
    const seen: string[] = []
    const tool = createTextToSpeechTool({
      projectRoot,
      synthesize: async (text) => {
        seen.push(text)
        return { audio: bytes, mimeType: 'audio/mpeg' }
      },
    })

    const raw = await tool.handler({ text: 'hello' })
    const result = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TextToSpeechResult

    expect(seen).toEqual(['hello'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mime_type).toBe('audio/mpeg')
    expect(result.bytes).toBe(4)
    const written = await readFile(join(projectRoot, result.path))
    expect([...written]).toEqual([1, 2, 3, 4])
  })
})
