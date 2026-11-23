import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'

import { InkInputProvider } from '@theokit/tui'
import { HooksGate, TrustGate } from '../../src/components/ConsentGates.js'

const hook = {
  fingerprint: 'fp',
  event: 'PreToolUse',
  command: 'echo \u001b[31mhi',
  status: 'new' as const,
}

describe('consent gates render the framework prompts', () => {
  it('shows a hook command with its escape sequence escaped, plus warning and key hint', () => {
    const consent = { pendingHooks: [hook] } as never
    const { lastFrame } = render(
      <HooksGate consent={consent} pendingHooks={[hook]} setToast={vi.fn()} />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('\u001b[31m')
    expect(frame).toMatch(/\\(x1b|u001b|e)/i)
    expect(frame).toContain('Approve only what you recognise')
    expect(frame).toContain('Esc to reject')
  })

  it('renders the trust prompt with the key hint', () => {
    const { lastFrame } = render(
      <TrustGate
        consent={{} as never}
        SESSION={{} as never}
        setToast={vi.fn()}
        setApprovalMode={vi.fn()}
        setEffort={vi.fn()}
        exit={vi.fn()}
      />,
    )
    expect(lastFrame()).toContain('Do you trust the files in this folder?')
    expect(lastFrame()).toContain('Esc to reject')
  })
})

describe('gate decisions', () => {
  it('toasts and does not close when the hook approval fails', async () => {
    const setToast = vi.fn()
    const approveHook = vi.fn().mockRejectedValue(new Error('disk full'))
    const consent = { approveHook, refuseHook: vi.fn(), pendingHooks: [hook] } as never
    const { stdin } = render(
      <InkInputProvider>
        <HooksGate consent={consent} pendingHooks={[hook]} setToast={setToast} />
      </InkInputProvider>,
    )
    await new Promise((r) => setTimeout(r, 50))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 50))
    expect(approveHook).toHaveBeenCalledWith('fp')
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', message: expect.stringContaining('disk full') }),
    )
  })

  it('toasts when trust cannot be persisted', async () => {
    const setToast = vi.fn()
    const consent = { trust: vi.fn().mockRejectedValue(new Error('read-only')) } as never
    const { stdin } = render(
      <InkInputProvider>
        <TrustGate
          consent={consent}
          SESSION={{} as never}
          setToast={setToast}
          setApprovalMode={vi.fn()}
          setEffort={vi.fn()}
          exit={vi.fn()}
        />
      </InkInputProvider>,
    )
    await new Promise((r) => setTimeout(r, 50))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 50))
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('could not persist trust') }),
    )
  })

  it('approves the hook on Enter without a toast', async () => {
    const setToast = vi.fn()
    const approveHook = vi.fn().mockResolvedValue(undefined)
    const consent = { approveHook, refuseHook: vi.fn(), pendingHooks: [hook] } as never
    const { stdin } = render(
      <InkInputProvider>
        <HooksGate consent={consent} pendingHooks={[hook]} setToast={setToast} />
      </InkInputProvider>,
    )
    await new Promise((r) => setTimeout(r, 50))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 50))
    expect(approveHook).toHaveBeenCalledWith('fp')
    expect(setToast).not.toHaveBeenCalled()
  })

  it('persists trust on Enter, reloads the config and applies it without a toast', async () => {
    const setToast = vi.fn()
    const setApprovalMode = vi.fn()
    const setEffort = vi.fn()
    const trust = vi.fn().mockResolvedValue(undefined)
    const SESSION = {
      reloadConfig: vi.fn(),
      cfg: () => ({ approvalMode: 'auto-edit' }),
      effort: () => 'high',
    }
    const { stdin } = render(
      <InkInputProvider>
        <TrustGate
          consent={{ trust } as never}
          SESSION={SESSION as never}
          setToast={setToast}
          setApprovalMode={setApprovalMode}
          setEffort={setEffort}
          exit={vi.fn()}
        />
      </InkInputProvider>,
    )
    await new Promise((r) => setTimeout(r, 50))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 50))
    expect(trust).toHaveBeenCalledTimes(1)
    expect(SESSION.reloadConfig).toHaveBeenCalledTimes(1)
    expect(setApprovalMode).toHaveBeenCalledWith('auto-edit')
    expect(setEffort).toHaveBeenCalledWith('high')
    expect(setToast).not.toHaveBeenCalled()
  })

  it('toasts when trust is granted but the settings cannot be reloaded', async () => {
    const setToast = vi.fn()
    const SESSION = {
      reloadConfig: () => {
        throw new Error('bad json')
      },
      cfg: () => ({ approvalMode: 'suggest' }),
      effort: () => 'low',
    }
    const { stdin } = render(
      <InkInputProvider>
        <TrustGate
          consent={{ trust: vi.fn().mockResolvedValue(undefined) } as never}
          SESSION={SESSION as never}
          setToast={setToast}
          setApprovalMode={vi.fn()}
          setEffort={vi.fn()}
          exit={vi.fn()}
        />
      </InkInputProvider>,
    )
    await new Promise((r) => setTimeout(r, 50))
    stdin.write('\r')
    await new Promise((r) => setTimeout(r, 50))
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', message: expect.stringContaining('bad json') }),
    )
  })

  it('shows the warning before the key hint for a hook prompt', () => {
    const { lastFrame } = render(
      <HooksGate
        consent={{ pendingHooks: [hook] } as never}
        pendingHooks={[hook]}
        setToast={vi.fn()}
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame.indexOf('Approve only what you recognise')).toBeLessThan(
      frame.indexOf('Esc to reject'),
    )
  })

  it('refusing a hook with Esc calls refuseHook, not approveHook, and shows no toast', async () => {
    const setToast = vi.fn()
    const approveHook = vi.fn().mockResolvedValue(undefined)
    const refuseHook = vi.fn()
    const consent = { approveHook, refuseHook, pendingHooks: [hook] } as never
    const { stdin } = render(
      <InkInputProvider>
        <HooksGate consent={consent} pendingHooks={[hook]} setToast={setToast} />
      </InkInputProvider>,
    )
    await new Promise((r) => setTimeout(r, 50))
    stdin.write('\u001b')
    await new Promise((r) => setTimeout(r, 100))
    expect(refuseHook).toHaveBeenCalledWith('fp')
    expect(approveHook).not.toHaveBeenCalled()
    expect(setToast).not.toHaveBeenCalled()
  })

  it('refusing trust with Esc quits without persisting trust or toasting', async () => {
    const setToast = vi.fn()
    const exit = vi.fn()
    const trust = vi.fn().mockResolvedValue(undefined)
    const { stdin } = render(
      <InkInputProvider>
        <TrustGate
          consent={{ trust } as never}
          SESSION={{ reloadConfig: vi.fn() } as never}
          setToast={setToast}
          setApprovalMode={vi.fn()}
          setEffort={vi.fn()}
          exit={exit}
        />
      </InkInputProvider>,
    )
    await new Promise((r) => setTimeout(r, 50))
    stdin.write('\u001b')
    await new Promise((r) => setTimeout(r, 100))
    expect(exit).toHaveBeenCalledTimes(1)
    expect(trust).not.toHaveBeenCalled()
    expect(setToast).not.toHaveBeenCalled()
  })

  it('labels the refusals so the outcome is clear before choosing', () => {
    const hooks = render(
      <HooksGate consent={{} as never} pendingHooks={[hook]} setToast={vi.fn()} />,
    )
    expect(hooks.lastFrame()).toContain('No, leave it inert')
    const trust = render(
      <TrustGate
        consent={{} as never}
        SESSION={{} as never}
        setToast={vi.fn()}
        setApprovalMode={vi.fn()}
        setEffort={vi.fn()}
        exit={vi.fn()}
      />,
    )
    expect(trust.lastFrame()).toContain('No, quit')
  })

  it('shows the trust warning before its key hint', () => {
    const { lastFrame } = render(
      <TrustGate
        consent={{} as never}
        SESSION={{} as never}
        setToast={vi.fn()}
        setApprovalMode={vi.fn()}
        setEffort={vi.fn()}
        exit={vi.fn()}
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Do you trust the files in this folder?')
    expect(frame.indexOf('Do you trust the files in this folder?')).toBeLessThan(
      frame.indexOf('Esc to reject'),
    )
  })
})
