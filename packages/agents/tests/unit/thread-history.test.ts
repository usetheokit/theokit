/**
 * Reading a thread's history without pretending a lost one is a new one (usetheokit/theokit#399).
 *
 * ## The measurement
 *
 * The framework serves `POST .../threads/<id>/message` and `GET .../threads/<id>/stream` and NO
 * history route — the one in the issue's repro belongs to the application, built on `loadJsonl` plus
 * a `catch` for ENOENT. That `catch` is where the defect lives: it is mandatory (a brand-new thread
 * has no file and must not 500), and it swallows every other read failure with it. A transcript that
 * exists and cannot be parsed renders as the same empty, successful, warm greeting.
 *
 * So the framework offered no way to ask the question with more than two answers, and two are not
 * enough.
 *
 * ## What this can and cannot decide, stated up front
 *
 * `absent` does NOT separate a lost conversation from a new one, and nothing here can: the id is
 * minted client-side (`client/agent-client.ts`) and nothing records that it was ever issued. That
 * distinction belongs to whoever knows where the id came from — an app that RESTORED it from storage
 * and finds no history is looking at a loss; the same absence for a freshly minted id is a new
 * conversation.
 *
 * What this does remove is the third case being silently folded into the second.
 */
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptPath } from '@theokit/sdk/persistence'
import { describe, expect, it } from 'vitest'

import { readThreadHistory } from '../../src/session/thread-history.js'

function projectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'theo-thread-history-'))
}

/** Write a transcript where `readThreadHistory` will look for it. */
function writeTranscript(root: string, cwd: string, sessionId: string, body: string): void {
  const path = transcriptPath(root, cwd, sessionId)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
}

describe('a thread with history reads as present', () => {
  it('test_a_written_transcript_comes_back_with_its_rows', () => {
    const root = projectRoot()
    const cwd = '/app'
    writeTranscript(root, cwd, 'th-1', '{"role":"user","text":"hi"}\n{"role":"assistant"}\n')

    const history = readThreadHistory('th-1', { cwd, root })

    expect(history.state).toBe('present')
    expect(history.messages).toHaveLength(2)
  })
})

describe('a thread with no transcript reads as absent, and says what that does not mean', () => {
  it('test_a_missing_transcript_is_absent_rather_than_an_error', () => {
    const root = projectRoot()

    const history = readThreadHistory('th-never-written', { cwd: '/app', root })

    // A brand-new thread has no file. Raising here would 500 the first turn of every conversation,
    // which is why every application catches — and why the catch grew too wide.
    expect(history.state).toBe('absent')
    expect(history.messages).toEqual([])
  })
})

describe('a transcript that cannot be read is NOT absent', () => {
  it('test_a_corrupt_transcript_reads_as_unreadable_and_carries_the_reason', () => {
    const root = projectRoot()
    const cwd = '/app'
    writeTranscript(root, cwd, 'th-corrupt', '{"role":"user"}\nnot json at all\n')

    const history = readThreadHistory('th-corrupt', { cwd, root })

    // The whole point: this used to be indistinguishable from "no history", so a damaged
    // conversation rendered as a warm greeting and the damage was never reported.
    expect(history.state).toBe('unreadable')
    expect(history.messages).toEqual([])
    expect(history.reason).toMatch(/line 2|JSON/i)
  })

  it('test_a_transcript_that_cannot_be_opened_reads_as_unreadable', () => {
    const root = projectRoot()
    const cwd = '/app'
    writeTranscript(root, cwd, 'th-locked', '{"role":"user"}\n')
    chmodSync(transcriptPath(root, cwd, 'th-locked'), 0o000)

    const history = readThreadHistory('th-locked', { cwd, root })

    // A permission error is not an absence either. Folding it in is how an operator loses a
    // conversation and is told nothing at all.
    expect(history.state).toBe('unreadable')
  })
})
