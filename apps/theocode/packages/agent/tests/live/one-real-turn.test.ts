/**
 * One turn against a LIVE model. The only test in this repository that does.
 *
 * ## Why it exists
 *
 * Measured 2026-09-15: of 216 test files here, 45 mock the provider and exactly one attempted a
 * real call — and that one skipped, because it needs a paid credential nobody has set. So a green
 * suite of 1806 tests said nothing about the half that makes this a coding agent: whether a turn
 * completes, whether the answer streams back, whether a provider error is recovered. Everything
 * else validated is the scaffolding AROUND that call.
 *
 * ## Why a local model rather than a credential
 *
 * `ollama` serves an OpenAI-compatible API on `localhost:11434/v1` and accepts any key, so the path
 * costs nothing and needs no secret — which is what lets it run in a place where a paid credential
 * cannot. That is the whole reason this is possible at all.
 *
 * ## What it does NOT claim
 *
 * A 1.5B model answering arithmetic is not evidence that this product is good, and this test does
 * not assert quality. It asserts that the PATH works: request leaves, response returns, content is
 * non-empty. Quality against a frontier model is a different question that needs a credential and
 * a human reading the output.
 *
 * Skips — never fails — when no local server answers, because a machine without one is not a
 * machine with a defect. The skip is loud in the report rather than silent.
 */
import { tokenBudgetCompactionStrategy } from '@theokit/agents'
import type { CompressibleMessage } from '@theokit/agents'
import { describe, expect, it } from 'vitest'

// Overridable so the SKIP path can be exercised. Pointing it at a dead port is the only way to
// prove these tests report "skipped" rather than "passed" when no server is there — the defect this
// file carried until 2026-09-15, when five guards were a bare `return` and vitest counted each of
// them as a pass. A green run with the server up says nothing about the case the guards exist for.
const OLLAMA = process.env.LIVE_BASE_URL ?? 'http://localhost:11434/v1'
const MODEL = 'qwen2.5:1.5b'

/**
 * The probe must interrogate the SAME origin the tests call. It used to be a hardcoded
 * `http://localhost:11434/api/tags` while the tests read `OLLAMA`, so the two could disagree — a
 * server on any other port made the probe answer about a host nothing under test would contact,
 * and the guard then waved through tests that could only fail. Derived from `OLLAMA` now, so the
 * question asked is the question that matters.
 */
async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(new URL('/api/tags', OLLAMA), {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

describe('a live turn, through the provider surface the product uses', () => {
  it('completes one turn and returns non-empty content', async (ctx) => {
    if (!(await serverIsUp())) ctx.skip()

    const res = await fetch(`${OLLAMA}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'Reply with exactly: READY' }],
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(120_000),
    })

    expect(res.ok).toBe(true)
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = body.choices?.[0]?.message?.content ?? ''

    // `length > 0` was the assertion here, and it was the weakest one in this file: the prompt asks
    // for READY and any non-empty text satisfied it — an error string, a greeting, the answer to a
    // different prompt. Found by TheoCode itself, reviewing this file through a frontier model, and
    // it named the line.
    //
    // Its proposed fix was `toBe('READY')`. That is right in principle and too strict for a 1.5B,
    // which returns `READY.` or `Ready` often enough to make this flaky — trading a weak assertion
    // for an intermittent one, which rules/testing.md calls a bug. Containment keeps the claim
    // (the instruction was followed) without demanding perfect formatting from a small model.
    expect(content.toUpperCase()).toContain('READY')
  }, 180_000)

  it('streams a turn rather than returning it whole', async (ctx) => {
    if (!(await serverIsUp())) ctx.skip()

    const res = await fetch(`${OLLAMA}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'Count: one two three' }],
        max_tokens: 24,
        stream: true,
      }),
      signal: AbortSignal.timeout(120_000),
    })

    expect(res.ok).toBe(true)
    expect(res.body).not.toBeNull()

    // More than one chunk is the whole claim: a single chunk is a non-streamed response wearing a
    // streaming content-type, which is what a mock would have produced.
    let chunks = 0
    const reader = res.body?.getReader()
    if (reader) {
      for (;;) {
        const { done } = await reader.read()
        if (done) break
        chunks += 1
        if (chunks > 2) break
      }
    }
    expect(chunks).toBeGreaterThan(1)
  }, 180_000)

  it('calls a tool it was given, with the argument the prompt implies', async (ctx) => {
    if (!(await serverIsUp())) ctx.skip()

    const res = await fetch(`${OLLAMA}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
      body: JSON.stringify({
        model: 'qwen2.5:3b',
        messages: [{ role: 'user', content: 'What is the weather in Lisbon? Use the tool.' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Current weather for a city',
              parameters: {
                type: 'object',
                properties: { city: { type: 'string' } },
                required: ['city'],
              },
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    })

    expect(res.ok).toBe(true)
    const body = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[]
    }
    const call = body.choices?.[0]?.message?.tool_calls?.[0]?.function

    // The NAME alone would pass for a model that calls every tool it is shown. The argument is what
    // proves it read the prompt: `Lisbon` appears nowhere in the schema, only in the question.
    expect(call?.name).toBe('get_weather')
    expect(String(call?.arguments ?? '')).toContain('Lisbon')
  }, 240_000)

  it('surfaces a provider error instead of hanging or inventing an answer', async (ctx) => {
    if (!(await serverIsUp())) ctx.skip()

    const res = await fetch(`${OLLAMA}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
      body: JSON.stringify({
        model: 'a-model-that-was-never-pulled',
        messages: [{ role: 'user', content: 'hello' }],
      }),
      signal: AbortSignal.timeout(60_000),
    })

    // The negative half: the path must report the failure. A 200 here would mean the server
    // answered for a model it does not have, and every error test built on this would be theatre.
    expect(res.ok).toBe(false)
  }, 120_000)

  it('compacts a transcript past its budget, with a LIVE model writing the summary', async (ctx) => {
    if (!(await serverIsUp())) ctx.skip()

    // 20 messages over a 50-token budget. Sized against the MACHINE, not against a guess: with a
    // stub summarizer this returns 2, and a short summary takes ~100s on this CPU-only host, so a
    // 60-message fixture (the first attempt) spent its whole budget inside `summarize` and returned
    // the transcript untouched at 60 — which reads exactly like compaction not working.
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Step ${String(i)}: rotate the deployment token, read docs/runbook-${String(i)}.md, and drain connections before swapping the image.`,
    }))

    // The contract is `(older, template) => Promise<CompressibleMessage>` — a MESSAGE, not a
    // string. Returning a bare string typechecked as `Promise<string>` and would have been handed
    // to the strategy as the summarised turn, where `.role` and `.content` are read. The compiler
    // caught it; the test would have failed at runtime on a field that is not there.
    //
    // The type is IMPORTED rather than written out: `role` is the union
    // `'user' | 'assistant' | 'system'`, and a hand-rolled `role: string` is wider, so it does
    // not satisfy the contract even once the shape is right.
    const summarize = async (
      toSummarize: CompressibleMessage[],
    ): Promise<CompressibleMessage> => {
      const res = await fetch(`${OLLAMA}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          messages: [
            { role: 'system', content: 'Summarise in one sentence.' },
            { role: 'user', content: toSummarize.map((mm) => `${mm.role}: ${mm.content}`).join('\n') },
          ],
          max_tokens: 80,
        }),
        signal: AbortSignal.timeout(300_000),
      })
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      return { role: 'user', content: body.choices?.[0]?.message?.content ?? '' }
    }

    const out = await tokenBudgetCompactionStrategy.compact(messages, { keepTokens: 50, summarize })

    // Three claims, each able to fail alone:
    //   it SHRANK — otherwise the budget did nothing
    //   the TAIL survived — compaction that drops the most recent turns is amnesia, not compaction
    //   the head carries the model's text — a strategy that silently truncates would also shrink
    //     and would also keep the tail, and only this separates the two
    expect(out.length).toBeLessThan(messages.length)
    expect(out.at(-1)?.content).toBe(messages.at(-1)?.content)
    // The head is the summary as a STRING, not a message object — measured, after asserting
    // `out[0].content` and reading `undefined` back. `compact()` returns a MIXED array: the
    // summary, then the messages it kept. Asserting the shape you assumed is how a test reports a
    // defect the product does not have.
    const head = out[0]
    const headText = typeof head === 'string' ? head : String((head as { content?: unknown })?.content ?? '')
    expect(headText.length).toBeGreaterThan(0)
  }, 420_000)
})
