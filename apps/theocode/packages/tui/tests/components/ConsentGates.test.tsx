import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'

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
