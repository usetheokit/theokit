/**
 * M9 (theokit-ai-first) — the guardrail pipeline: apply guards in order at a boundary phase.
 *
 * Fail-fast (error-handling.md): a `block` throws {@link GuardrailViolationError} immediately.
 * A `redact` threads the transformed text into the next guard. Independent of the SDK runtime —
 * this runs at the framework boundary, before/after the SDK does its work.
 */
import { type Guardrail, GuardrailViolationError } from './types.js'

/**
 * Run every guard's `checkInput` in order against `text`. Returns the (possibly redacted) text.
 * Throws {@link GuardrailViolationError} on the first `block`. Guards without `checkInput` are skipped.
 */
export async function runInputGuards(text: string, guards: readonly Guardrail[]): Promise<string> {
  let current = text
  for (const g of guards) {
    if (!g.checkInput) continue
    const r = await g.checkInput(current)
    if (r.action === 'block') {
      throw new GuardrailViolationError(g.name, 'input', r.reason ?? 'blocked')
    }
    if (r.action === 'redact' && r.text !== undefined) current = r.text
  }
  return current
}

/**
 * Run every guard's `checkOutput` in order against `text`. Returns the (possibly redacted) text.
 * Throws {@link GuardrailViolationError} on the first `block`. Guards without `checkOutput` are skipped.
 */
export async function runOutputGuards(text: string, guards: readonly Guardrail[]): Promise<string> {
  let current = text
  for (const g of guards) {
    if (!g.checkOutput) continue
    const r = await g.checkOutput(current)
    if (r.action === 'block') {
      throw new GuardrailViolationError(g.name, 'output', r.reason ?? 'blocked')
    }
    if (r.action === 'redact' && r.text !== undefined) current = r.text
  }
  return current
}
