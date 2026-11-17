/**
 * Real transcripts on disk for the `sessions gc` command tests (#1918).
 *
 * The command is `planAndRunCurrentProjectGC` + `humanReport` from the CLI, run against a temp
 * transcript root and a temp cwd, so a regression in what the command hands the framework (the TUI
 * pointer, the registry ids, the options) fails here rather than only in the framework's own suite.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { legacyTranscriptPath, transcriptPath } from '@theokit/agents/persistence'
import { afterEach, beforeEach } from 'vitest'

import { pointerPath } from '../../../src/session/gc/pointer.js'

export const DAY = 86_400_000
export const NOW = new Date('2026-08-13T12:00:00Z').getTime()

export interface Fixture {
  root: string
  cwd: string
}

export function useFixture(): Fixture {
  const fx: Fixture = { root: '', cwd: '' }
  beforeEach(() => {
    fx.root = mkdtempSync(join(tmpdir(), 'theocode-gc-root-'))
    fx.cwd = mkdtempSync(join(tmpdir(), 'theocode-gc-cwd-'))
  })
  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true })
    rmSync(fx.cwd, { recursive: true, force: true })
  })
  return fx
}

/** Write a transcript for `sessionId`, `ageDays` old. `legacy` uses the 4.x name (the id itself). */
export function writeTranscript(
  fx: Fixture,
  sessionId: string,
  ageDays: number,
  opts: { legacy?: boolean; content?: string } = {},
): string {
  const path = (opts.legacy === true ? legacyTranscriptPath : transcriptPath)(
    fx.root,
    fx.cwd,
    sessionId,
  )
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, opts.content ?? `${JSON.stringify({ type: 'user', sessionId })}\n`, 'utf8')
  const when = new Date(NOW - ageDays * DAY)
  utimesSync(path, when, when)
  return path
}

export function writePointer(fx: Fixture, sessionId: string): void {
  mkdirSync(join(pointerPath(fx.cwd), '..'), { recursive: true })
  writeFileSync(pointerPath(fx.cwd), `${sessionId}\n`)
}
