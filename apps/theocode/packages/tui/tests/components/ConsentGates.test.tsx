/**
 * #2798 — the rendered consent gates: warnings, key hints, choices, and what each answer does,
 * including a failed trust persist (rollback) and a failed config reload.
 */
import { render } from 'ink-testing-library'
import { InkInputProvider } from '@theokit/tui'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const trustDir = vi.hoisted(() => vi.fn<(dir: string) => Promise<void>>())
vi.mock('@theocode/agent/config', async (orig) => ({
  ...(await orig<typeof import('@theocode/agent/config')>()),
  trustDir,
}))

import { HooksGate, TrustGate } from '../../src/components/ConsentGates.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tick = () => wait(150)
/** Ink attaches its stdin listener after mount; a key written earlier is dropped. */
const press = async (stdin: { write: (s: string) => void }, key: string) => {
  await wait(60)
  stdin.write(key)
  await tick()
}
/** Collapse wrapping so an assertion is about words, not where the terminal broke the line. */
const flat = (f: string | undefined) => (f ?? '').replace(/\s+/g, ' ')
const ENTER = '\r'
const ESC = '\u001b'

function consentFake() {
  return {
    trust: vi.fn(),
    distrust: vi.fn(),
    approveHookConsent: vi.fn(() => Promise.resolve()),
    refuseHook: vi.fn(),
    markReviewed: vi.fn(),
  }
}

const hook = (over: Record<string, unknown> = {}) => ({
  status: 'new',
  fingerprint: 'fp1',
  spec: { event: 'PreToolUse', command: 'echo hi' },
  ...over,
})

function mountHooks(pending: unknown[]) {
  const consent = consentFake()
  const setToast = vi.fn()
  const view = render(
    <InkInputProvider>
      <HooksGate consent={consent as never} pendingHooks={pending as never} setToast={setToast} />
    </InkInputProvider>,
  )
  return { consent, setToast, ...view }
}

describe('HooksGate', () => {
  it('test_renders_the_warning_before_the_choices_and_the_key_hint_below_them', () => {
    const { lastFrame } = mountHooks([hook()])
    const frame = flat(lastFrame())
    expect(frame).toContain('Review hook')
    expect(frame).toContain('one hook needs review')
    expect(frame).toContain('[new] PreToolUse')
    expect(frame).toContain('echo hi')
    expect(frame).toContain('you will be asked again next launch')
    expect(frame).toContain('No, leave it inert')
    expect(frame.indexOf('This command runs on every matching tool call')).toBeLessThan(
      frame.indexOf('No, leave it inert'),
    )
    expect(frame.indexOf('No, leave it inert')).toBeLessThan(frame.indexOf('Enter to confirm'))
    expect(frame).toContain('Esc to reject')
  })

  it('test_a_changed_hook_shows_was_and_now', () => {
    const { lastFrame } = mountHooks([
      hook({
        status: 'modified',
        previousCommand: 'old-cmd',
        spec: { event: 'Stop', command: 'new-cmd' },
      }),
    ])
    const frame = flat(lastFrame())
    expect(frame).toContain('[changed] Stop')
    expect(frame).toContain('was: old-cmd')
    expect(frame).toContain('now: new-cmd')
  })

  it('test_several_pending_hooks_are_counted_and_reviewed_one_at_a_time', () => {
    const { lastFrame } = mountHooks([hook(), hook({ fingerprint: 'fp2' })])
    expect(flat(lastFrame())).toContain('2 hooks need review — one at a time')
  })

  it('test_enter_approves_the_last_hook_and_closes_the_gate', async () => {
    const { consent, stdin } = mountHooks([hook()])
    await press(stdin, ENTER)
    expect(consent.approveHookConsent).toHaveBeenCalledWith({
      event: 'PreToolUse',
      command: 'echo hi',
    })
    expect(consent.markReviewed).toHaveBeenCalledTimes(1)
    expect(consent.refuseHook).not.toHaveBeenCalled()
  })

  it('test_escape_refuses_the_hook_without_approving', async () => {
    const { consent, stdin } = mountHooks([hook()])
    await press(stdin, ESC)
    expect(consent.refuseHook).toHaveBeenCalledWith('fp1')
    expect(consent.approveHookConsent).not.toHaveBeenCalled()
    expect(consent.markReviewed).toHaveBeenCalledTimes(1)
  })

  it('test_refusing_with_more_pending_keeps_the_gate_open', async () => {
    const { consent, stdin } = mountHooks([hook(), hook({ fingerprint: 'fp2' })])
    await press(stdin, ESC)
    expect(consent.refuseHook).toHaveBeenCalledWith('fp1')
    expect(consent.markReviewed).not.toHaveBeenCalled()
  })

  it('test_a_failed_persist_toasts_the_error_and_leaves_the_gate_open', async () => {
    const { consent, setToast, stdin } = mountHooks([hook()])
    consent.approveHookConsent.mockRejectedValueOnce(new Error('EROFS'))
    await press(stdin, ENTER)
    expect(consent.markReviewed).not.toHaveBeenCalled()
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', message: expect.stringContaining('EROFS') }),
    )
  })
})

function mountTrust(over: { reload?: () => void } = {}) {
  const consent = consentFake()
  const setToast = vi.fn()
  const setApprovalMode = vi.fn()
  const setEffort = vi.fn()
  const exit = vi.fn()
  const SESSION = {
    reloadConfig: over.reload ?? vi.fn(),
    cfg: () => ({ approvalMode: 'auto' as never }),
    effort: () => 'high' as never,
  }
  const view = render(
    <InkInputProvider>
      <TrustGate
        consent={consent as never}
        SESSION={SESSION}
        setToast={setToast}
        setApprovalMode={setApprovalMode}
        setEffort={setEffort}
        exit={exit}
      />
    </InkInputProvider>,
  )
  return { consent, setToast, setApprovalMode, setEffort, exit, ...view }
}

describe('TrustGate', () => {
  beforeEach(() => {
    trustDir.mockReset()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('test_renders_the_warning_the_quit_choice_and_the_key_hint', () => {
    const { lastFrame } = mountTrust()
    const frame = flat(lastFrame())
    expect(frame).toContain('Trust directory')
    expect(frame).toContain('Trust only directories you control')
    expect(frame).toContain('reject to quit')
    expect(frame).toContain('No, quit')
    expect(frame.indexOf('No, quit')).toBeLessThan(frame.indexOf('Enter to confirm'))
    expect(frame).toContain('Esc to reject')
  })

  it('test_approving_persists_trust_then_reloads_the_config', async () => {
    trustDir.mockResolvedValue(undefined)
    const { consent, setApprovalMode, setEffort, setToast, stdin } = mountTrust()
    await press(stdin, ENTER)
    expect(trustDir).toHaveBeenCalledTimes(1)
    expect(consent.trust).toHaveBeenCalledTimes(1)
    expect(consent.distrust).not.toHaveBeenCalled()
    expect(setApprovalMode).toHaveBeenCalledWith('auto')
    expect(setEffort).toHaveBeenCalledWith('high')
    expect(setToast).not.toHaveBeenCalled()
  })

  it('test_a_failed_trust_persist_rolls_trust_back_and_says_to_retry', async () => {
    trustDir.mockRejectedValue(new Error('EACCES'))
    const { consent, setApprovalMode, setToast, stdin } = mountTrust()
    await press(stdin, ENTER)
    expect(consent.trust).toHaveBeenCalledTimes(1)
    expect(consent.distrust).toHaveBeenCalledTimes(1)
    expect(setApprovalMode).not.toHaveBeenCalled()
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        message: expect.stringMatching(/EACCES.*still untrusted.*retry/),
      }),
    )
  })

  it('test_a_config_that_cannot_be_reloaded_keeps_trust_and_toasts', async () => {
    trustDir.mockResolvedValue(undefined)
    const { consent, setApprovalMode, setToast, stdin } = mountTrust({
      reload: () => {
        throw new Error('bad json')
      },
    })
    await press(stdin, ENTER)
    expect(consent.distrust).not.toHaveBeenCalled()
    expect(setApprovalMode).not.toHaveBeenCalled()
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('bad json') }),
    )
  })

  it('test_rejecting_quits_and_persists_nothing', async () => {
    const { consent, exit, stdin } = mountTrust()
    await press(stdin, ESC)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(trustDir).not.toHaveBeenCalled()
    expect(consent.trust).not.toHaveBeenCalled()
  })
})
