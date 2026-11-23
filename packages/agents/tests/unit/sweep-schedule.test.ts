import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scheduleSessionSweep, sweepDecision } from '../../src/session/index.js'

const now = new Date('2026-01-10T00:00:00Z')

function fakeChild(): EventEmitter & {
  stdout: EventEmitter & { unref: () => void }
  unref: () => void
} {
  return Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { unref: vi.fn() }),
    unref: vi.fn(),
  })
}

function setup(stamp?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-'))
  const stampFile = join(dir, '.last-session-gc')
  if (stamp !== undefined) writeFileSync(stampFile, stamp)
  return { stampFile }
}

describe('sweepDecision', () => {
  it('returns too-soon inside the interval and run after it', () => {
    const lastRun = new Date('2026-01-09T12:00:00Z')
    expect(sweepDecision({ enabled: true, now, intervalHours: 24, lastRun })).toEqual({
      run: false,
      reason: 'too-soon',
      lastRun,
    })
    expect(sweepDecision({ enabled: true, now, intervalHours: 12, lastRun })).toEqual({
      run: true,
      firstRun: false,
    })
    expect(sweepDecision({ enabled: false, now, intervalHours: 1, lastRun: undefined })).toEqual({
      run: false,
      reason: 'disabled',
    })
  })

  it('an unparseable stamp counts as a first run', () => {
    expect(
      sweepDecision({ enabled: true, now, intervalHours: 24, lastRun: new Date('nope') }),
    ).toEqual({
      run: true,
      firstRun: true,
    })
    const { stampFile } = setup('garbage')
    const spawn = vi.fn(() => fakeChild())
    const r = scheduleSessionSweep({
      enabled: true,
      stampFile,
      now,
      onReport: () => {},
      command: () => ({ command: 'x', args: [] }),
      spawn: spawn as never,
    })
    expect(r.reason).toBe('first-run-dry')
  })
})

describe('scheduleSessionSweep', () => {
  it('the first run spawns with apply false and later runs with apply true', () => {
    const applies: boolean[] = []
    const run = (stampFile: string) =>
      scheduleSessionSweep({
        enabled: true,
        stampFile,
        now,
        onReport: () => {},
        command: ({ apply }) => {
          applies.push(apply)
          return { command: 'node', args: apply ? ['--apply'] : [] }
        },
        spawn: (() => fakeChild()) as never,
      })
    expect(run(setup().stampFile).reason).toBe('first-run-dry')
    expect(run(setup('2026-01-01T00:00:00Z').stampFile).reason).toBe('applying')
    expect(applies).toEqual([false, true])
    expect(run(setup('2026-01-09T23:00:00Z').stampFile)).toEqual({
      started: false,
      reason: 'too-soon',
    })
  })

  it('the stamp is written before the child is spawned', () => {
    const { stampFile } = setup()
    let stampAtSpawn: string | undefined
    scheduleSessionSweep({
      enabled: true,
      stampFile,
      now,
      onReport: () => {},
      command: () => ({ command: 'node', args: [] }),
      spawn: (() => {
        stampAtSpawn = existsSync(stampFile) ? readFileSync(stampFile, 'utf8') : undefined
        return fakeChild()
      }) as never,
    })
    expect(stampAtSpawn).toBe(now.toISOString())
  })

  it('a spawn that throws is reported once and scheduleSessionSweep returns spawn-failed without throwing', () => {
    const onReport = vi.fn()
    const r = scheduleSessionSweep({
      enabled: true,
      stampFile: setup().stampFile,
      now,
      onReport,
      command: () => ({ command: 'node', args: [] }),
      spawn: (() => {
        throw new Error('boom')
      }) as never,
    })
    expect(r).toEqual({ started: false, reason: 'spawn-failed' })
    expect(onReport).toHaveBeenCalledTimes(1)
    expect(onReport.mock.calls[0]?.[0]).toContain('boom')
  })

  it('the child is spawned with the timeout and SIGTERM kill signal', () => {
    const spawn = vi.fn(() => fakeChild())
    scheduleSessionSweep({
      enabled: true,
      stampFile: setup().stampFile,
      now,
      timeoutMs: 1234,
      onReport: () => {},
      command: () => ({ command: 'node', args: ['a'] }),
      spawn: spawn as never,
    })
    expect(spawn).toHaveBeenCalledWith(
      'node',
      ['a'],
      expect.objectContaining({
        timeout: 1234,
        killSignal: 'SIGTERM',
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )
  })

  it('reports the last stdout line when the child closes', () => {
    const child = fakeChild()
    const onReport = vi.fn()
    scheduleSessionSweep({
      enabled: true,
      stampFile: setup('2026-01-01T00:00:00Z').stampFile,
      now,
      onReport,
      command: () => ({ command: 'node', args: [] }),
      spawn: (() => child) as never,
    })
    child.stdout.emit('data', Buffer.from('noise\nremoved 3 of 4\n'))
    child.emit('close', 0)
    expect(onReport).toHaveBeenCalledExactlyOnceWith('removed 3 of 4')
  })

  it('unrefs the child and its stdout pipe so the parent can exit', () => {
    const child = fakeChild()
    scheduleSessionSweep({
      enabled: true,
      stampFile: setup().stampFile,
      now,
      onReport: () => {},
      command: () => ({ command: 'node', args: [] }),
      spawn: (() => child) as never,
    })
    expect(child.unref).toHaveBeenCalled()
    expect(child.stdout.unref).toHaveBeenCalled()
  })
})
