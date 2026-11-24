import { describe, expect, it } from 'vitest'

import { EmptyPromptError, readHeadlessPrompt, runHeadlessTurn } from '../../src/commands/index.js'

import type { WireChunk } from '@theokit/presenter/wire'

async function* from(chunks: unknown[]): AsyncGenerator<WireChunk> {
  for (const c of chunks) yield c as WireChunk
}

function io() {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } }
}

const text = (id: string, t: string) => [
  { type: 'text-start', id },
  { type: 'text-delta', id, delta: t },
  { type: 'text-end', id },
]
const tool = (id: string) => [
  { type: 'tool-input-available', toolCallId: id, toolName: 'read', input: {} },
  { type: 'tool-output-available', toolCallId: id, output: 'x' },
]
const finish = (messageMetadata?: unknown) => ({ type: 'finish', messageMetadata })

describe('runHeadlessTurn', () => {
  it('a turn with a preamble and an answer prints only the answer on out', async () => {
    const t = io()
    const chunks = [
      ...text('a', 'Let me look.'),
      ...tool('c1'),
      ...text('b', 'The answer.'),
      finish(),
    ]
    const r = await runHeadlessTurn(from(chunks), { io: t.io })
    expect(t.out.join('')).toBe('The answer.\n')
    expect(t.err.join('')).toContain('read')
    expect(r).toMatchObject({ outcome: 'ok', exitCode: 0, finalText: 'The answer.' })
  })

  it('a finish chunk with stopReason step_limit gives outcome cut and exit code 2', async () => {
    const t = io()
    const meta = { stopReason: 'step_limit', usage: { totalTokens: 3 } }
    const r = await runHeadlessTurn(from([...text('a', 'partial'), finish(meta)]), { io: t.io })
    expect(r).toMatchObject({ outcome: 'cut', exitCode: 2, stopReason: 'step_limit' })
    expect(r.usage).toEqual({ totalTokens: 3 })
    expect(t.err.join('')).toContain('step_limit')
  })

  it('a stream that throws gives outcome error, exit code 1 and the message on err', async () => {
    const t = io()
    async function* boom(): AsyncGenerator<WireChunk> {
      yield* from(text('a', 'hi'))
      throw new Error('socket closed')
    }
    const r = await runHeadlessTurn(boom(), { io: t.io })
    expect(r).toMatchObject({ outcome: 'error', exitCode: 1 })
    expect(t.err.join('')).toContain('socket closed')
  })

  it('an error chunk carries its code', async () => {
    const t = io()
    const chunks = [
      { type: 'data-error-code', data: { code: 'rate_limited' } },
      { type: 'error', errorText: 'slow down' },
    ]
    const r = await runHeadlessTurn(from(chunks), { io: t.io })
    expect(r).toMatchObject({ outcome: 'error', errorCode: 'rate_limited', exitCode: 1 })
  })

  it('a turn with no text and no tool calls gives outcome empty and a diagnostic', async () => {
    const t = io()
    const r = await runHeadlessTurn(from([finish()]), { io: t.io })
    expect(r).toMatchObject({ outcome: 'empty', exitCode: 1 })
    expect(t.err.join('')).toMatch(/no text/)
  })

  it('exitCodes overrides the defaults', async () => {
    const t = io()
    const r = await runHeadlessTurn(from([finish({ stopReason: 'no_progress' })]), {
      io: t.io,
      exitCodes: { cut: 3 },
    })
    expect(r.exitCode).toBe(3)
  })

  it('json mode writes one parseable line per canonical event', async () => {
    const t = io()
    const chunks = [...tool('c1'), ...text('b', 'done'), finish()]
    const r = await runHeadlessTurn(from(chunks), { io: t.io, json: true })
    const lines = t.out.join('').split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    const types = lines.map((l) => (JSON.parse(l) as { type: string }).type)
    expect(types).toContain('tool-call')
    expect(types).toContain('text')
    expect(r.finalText).toBe('done')
  })

  it('outputLastMessage receives the final text', async () => {
    const t = io()
    const got: string[] = []
    await runHeadlessTurn(from(text('a', 'hello')), {
      io: t.io,
      outputLastMessage: (s) => {
        got.push(s)
      },
    })
    expect(got).toEqual(['hello'])
  })

  it('a throwing outputLastMessage gives outcome error', async () => {
    const t = io()
    const r = await runHeadlessTurn(from(text('a', 'hello')), {
      io: t.io,
      outputLastMessage: () => {
        throw new Error('disk full')
      },
    })
    expect(r.outcome).toBe('error')
    expect(t.err.join('')).toContain('disk full')
  })
})

describe('runHeadlessTurn format', () => {
  it('writes only the formatter strings and keeps the exit code rule', async () => {
    const t = io()
    const r = await runHeadlessTurn(from([finish()]), {
      io: t.io,
      format: (e) => (e.type === 'finish' ? undefined : { out: `<${e.type}>` }),
    })
    expect(r).toMatchObject({ outcome: 'empty', exitCode: 1 })
    expect(t.err).toEqual([])
    expect(t.out.every((s) => /^<.+>$/.test(s))).toBe(true)
  })

  it('does not print the final text or json when a formatter is given', async () => {
    const t = io()
    const r = await runHeadlessTurn(from([...text('a', 'hello'), finish()]), {
      io: t.io,
      json: true,
      format: () => ({ err: 'e' }),
    })
    expect(r).toMatchObject({ outcome: 'ok', exitCode: 0, finalText: 'hello' })
    expect(t.out).toEqual([])
    expect(t.err.length).toBeGreaterThan(0)
    expect(t.err.every((s) => s === 'e')).toBe(true)
  })

  it('reports the message of a thrown stream when a format is given', async () => {
    async function* boom(): AsyncGenerator<WireChunk> {
      yield* from(text('a', 'hi'))
      throw new Error('boom')
    }
    const r = await runHeadlessTurn(boom(), { io: io().io, format: () => undefined })
    expect(r.outcome).toBe('error')
    expect(r.errorMessage).toBe('boom')
  })

  it('a throwing format is ignored by default and fatal with onFormatError fail', async () => {
    const format = () => {
      throw new Error('bad format')
    }
    const chunks = () => from([...text('a', 'hi'), finish()])
    const ignored = await runHeadlessTurn(chunks(), { io: io().io, format })
    expect(ignored).toMatchObject({ outcome: 'ok', exitCode: 0 })
    expect(ignored.errorMessage).toBeUndefined()
    const fatal = await runHeadlessTurn(chunks(), { io: io().io, format, onFormatError: 'fail' })
    expect(fatal).toMatchObject({ outcome: 'error', exitCode: 1, errorMessage: 'bad format' })
  })
})

describe('readHeadlessPrompt', () => {
  it('forced reads piped input when the argument is -', () => {
    expect(readHeadlessPrompt({ prompt: '-', stdin: 'forced', readStdin: () => 'piped\n' })).toBe(
      'piped',
    )
  })

  it('forced with empty stdin and a - argument throws EmptyPromptError', () => {
    const read = () => readHeadlessPrompt({ prompt: '-', stdin: 'forced', readStdin: () => '' })
    expect(read).toThrow(EmptyPromptError)
  })

  it('with stdin required and empty input throws EmptyPromptError', () => {
    const read = () => readHeadlessPrompt({ stdin: 'required', readStdin: () => '  \n' })
    expect(read).toThrow(EmptyPromptError)
  })

  it('required uses stdin as the prompt', () => {
    expect(readHeadlessPrompt({ stdin: 'required', readStdin: () => 'hi\n' })).toBe('hi')
  })

  it('append wraps stdin in a <stdin> block', () => {
    const prompt = readHeadlessPrompt({
      prompt: 'review',
      stdin: 'append',
      readStdin: () => 'diff\n',
    })
    expect(prompt).toBe('review\n\n<stdin>\ndiff\n</stdin>')
  })

  it('ignore never reads stdin, and an empty prompt throws', () => {
    const never = () => {
      throw new Error('read')
    }
    expect(readHeadlessPrompt({ prompt: 'x', stdin: 'ignore', readStdin: never })).toBe('x')
    const empty = () => readHeadlessPrompt({ stdin: 'ignore', readStdin: () => '' })
    expect(empty).toThrow(EmptyPromptError)
  })
})
