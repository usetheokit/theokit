/**
 * M9 (theokit-ai-first) — guardrail contract + typed errors.
 *
 * ADR-0040 § D2: guardrails are a HOME/BOUNDARY concern (filter user input before the SDK,
 * filter model output before the client). They REUSE the SDK runtime — this module makes zero
 * LLM calls. A guard reports one of three actions; the pipeline (`pipeline.ts`) enforces them.
 */

/** What a guard decided for a piece of text. */
export type GuardrailAction = 'allow' | 'block' | 'redact'

/**
 * The result of a single guard check.
 * - `allow`  — text passes untouched.
 * - `block`  — the pipeline throws {@link GuardrailViolationError}; the run stops fail-fast.
 * - `redact` — the pipeline replaces the text with {@link GuardrailResult.text} and continues.
 */
export interface GuardrailResult {
  action: GuardrailAction
  /** Human-readable reason — required in spirit for `block`, surfaced in the thrown error. */
  reason?: string
  /** The transformed text — present (and used) only when `action === 'redact'`. */
  text?: string
}

/**
 * A guardrail. A guard MAY inspect input (before the model), output (after the model), or both.
 * A guard that omits a phase hook is skipped for that phase.
 */
export interface Guardrail {
  readonly name: string
  checkInput?(text: string): GuardrailResult | Promise<GuardrailResult>
  checkOutput?(text: string): GuardrailResult | Promise<GuardrailResult>
}

/** Which boundary phase a violation happened in. */
export type GuardrailPhase = 'input' | 'output'

/** Thrown (fail-fast) when a guard returns `action: 'block'`. Typed per error-handling.md. */
export class GuardrailViolationError extends Error {
  constructor(
    public readonly guardName: string,
    public readonly phase: GuardrailPhase,
    public readonly reason: string,
  ) {
    super(`Guardrail "${guardName}" blocked ${phase}: ${reason}`)
    this.name = 'GuardrailViolationError'
  }
}

/** Thrown when {@link costGuard}'s cumulative token budget is exceeded. */
export class CostBudgetExceededError extends Error {
  constructor(
    public readonly usedTokens: number,
    public readonly maxTokens: number,
  ) {
    super(`Cost budget exceeded: ${usedTokens} > ${maxTokens} tokens`)
    this.name = 'CostBudgetExceededError'
  }
}
