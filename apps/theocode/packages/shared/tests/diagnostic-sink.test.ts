/**
 * Whether diagnostics are on is a QUESTION the failure text needs to answer, so it has to be
 * readable after the install.
 *
 * `installDiagnosticSink` has always returned the answer — `result.kind !== 'off'` — and all three
 * entry points discarded it (`cli/src/main.ts:16`, `tui/src/main.tsx:15`, `agent/src/chat-acp.ts:12`).
 * The value was computed and thrown away, so `turnErrorText` could not tell an operator who already
 * enabled diagnostics from one who had never heard of the variable.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { diagnosticsEnabled, installDiagnosticSink } from '../src/diagnostic-sink.js'

describe('diagnosticsEnabled', () => {
  beforeEach(() => {
    installDiagnosticSink(() => {}, {})
  })

  it('test_it_is_false_before_anything_asked_for_diagnostics', () => {
    expect(diagnosticsEnabled()).toBe(false)
  })

  it('test_it_becomes_true_when_the_operator_set_the_variable', () => {
    const installed = installDiagnosticSink(() => {}, { THEOCODE_DIAGNOSTICS: 'stderr' })

    expect(installed, 'the install reported off for a variable that is set').toBe(true)
    expect(diagnosticsEnabled(), 'the install result was computed and then discarded').toBe(true)
  })

  it('test_it_reflects_the_most_recent_install_rather_than_latching', () => {
    installDiagnosticSink(() => {}, { THEOCODE_DIAGNOSTICS: 'stderr' })
    installDiagnosticSink(() => {}, {})

    expect(diagnosticsEnabled()).toBe(false)
  })
})
