/**
 * B-076 — loosening the sandbox needs a confirmation; tightening does not.
 *
 * The asymmetry is the design: a user hardening mid-session is protecting themselves and should not
 * be argued with; one loosening is granting the agent more of their disk and should have to mean it.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  armLoosening,
  clearArmed,
  isLoosening,
  parseSandboxMode,
  takeArmed,
} from '../../src/commands/sandbox-command.js'

beforeEach(() => {
  clearArmed()
})

describe('B-076 — parseSandboxMode', () => {
  it('test_accepts_the_three_modes', () => {
    expect(parseSandboxMode('read-only')).toBe('read-only')
    expect(parseSandboxMode(' WORKSPACE-WRITE ')).toBe('workspace-write')
    expect(parseSandboxMode('danger-full-access')).toBe('danger-full-access')
  })

  it('test_rejects_anything_else', () => {
    expect(parseSandboxMode('yolo')).toBeNull()
    expect(parseSandboxMode('')).toBeNull()
  })
})

describe('B-076 — isLoosening', () => {
  it('test_moving_up_the_scale_loosens', () => {
    expect(isLoosening('read-only', 'workspace-write')).toBe(true)
    expect(isLoosening('workspace-write', 'danger-full-access')).toBe(true)
    expect(isLoosening('read-only', 'danger-full-access')).toBe(true)
  })

  it('test_tightening_and_staying_do_not', () => {
    expect(isLoosening('danger-full-access', 'read-only')).toBe(false)
    expect(isLoosening('workspace-write', 'workspace-write')).toBe(false)
  })
})

describe('B-076 — the arming latch', () => {
  it('test_taking_the_armed_mode_consumes_it', () => {
    // Single-use: a confirmation must not be replayable.
    armLoosening('danger-full-access')
    expect(takeArmed()).toBe('danger-full-access')
    expect(takeArmed()).toBeUndefined()
  })

  it('test_a_second_request_replaces_the_first', () => {
    // The dangerous sequence: ask for full access, change your mind to read-only, then confirm.
    // Confirming must never grant the abandoned request.
    armLoosening('danger-full-access')
    armLoosening('workspace-write')
    expect(takeArmed()).toBe('workspace-write')
  })

  it('test_clearing_disarms', () => {
    armLoosening('danger-full-access')
    clearArmed()
    expect(takeArmed()).toBeUndefined()
  })
})
