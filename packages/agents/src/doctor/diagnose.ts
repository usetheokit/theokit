/**
 * M84 — the doctor primitive: mechanism only.
 *
 * ## The absence this closes
 *
 * There was no resolved-state report. `theokit info` answers "does my project parse?"; the question
 * an agent product actually has is different — **what will this installation do?** Which credential,
 * which config layers, which trust posture, which sandbox, which MCP servers, which skills, which
 * hooks.
 *
 * ## The hard rule: never print a secret
 *
 * A doctor that prints secrets is a doctor nobody can paste into an issue — so the one command built
 * for support becomes the one command you must not share. A credential is therefore reported as
 * `present`, `absent` or `unreadable`, and never as a value: not the value, not a prefix, not a
 * truncation, not its length.
 *
 * A truncated key keeps its most identifying bytes, and `sk-ant-…` in a public issue names the
 * account it belongs to. A length narrows a brute force and identifies the provider. Neither is ever
 * useful in a bug report, and both are free to leak.
 *
 * ## What stays the product's
 *
 * The LIST of checks. This module holds the quartet — `Check`, `Diagnosis`, `diagnose`,
 * `renderDiagnosis` — because that is the part every product re-derives identically. Which things to
 * check is exactly the part that differs per product, and absorbing it would make this a framework
 * for one app.
 */

/** What a single check found. */
export interface Check {
  /** What was examined, as a human would name it: `credential`, `sandbox`, `mcp`. */
  readonly name: string
  /**
   * `warn` is deliberately NOT a failure. "no MCP servers configured" is worth saying and is not
   * broken — counting it as a failure makes a green install exit non-zero, and CI learns to ignore
   * the command.
   */
  readonly status: 'ok' | 'warn' | 'fail'
  /** One line a human can act on. Never a secret — see {@link secretPresence}. */
  readonly detail: string
}

export interface Diagnosis {
  readonly checks: readonly Check[]
  /** How many checks failed. Warnings are not counted. */
  readonly failed: number
  /** `0` when the installation is usable. See the note on the empty case. */
  readonly exitCode: number
}

/**
 * Aggregate checks into a verdict.
 *
 * An EMPTY list exits non-zero. That is not pedantry: a product whose check list failed to load
 * would otherwise report a clean bill of health for an installation nobody examined — and "no checks
 * ran" is a different fact from "everything passed", which is the distinction this whole module is
 * about.
 */
export function diagnose(checks: readonly Check[]): Diagnosis {
  const failed = checks.filter((check) => check.status === 'fail').length
  const exitCode = checks.length === 0 || failed > 0 ? 1 : 0
  return { checks, failed, exitCode }
}

const SYMBOL: Readonly<Record<Check['status'], string>> = {
  ok: '✓',
  warn: '!',
  fail: '✗',
}

/**
 * Render a diagnosis as text a human reads and pastes.
 *
 * Plain text with no colour: the output's destination is an issue, a CI log or a terminal that may
 * not support colour, and escape codes in a pasted report are noise between the reader and the fact.
 */
export function renderDiagnosis(diagnosis: Diagnosis): string {
  const lines = diagnosis.checks.map(
    (check) => `${SYMBOL[check.status]} ${check.name}: ${check.detail}`,
  )
  const summary =
    diagnosis.checks.length === 0
      ? 'no checks ran — that is not the same as everything passing'
      : `${String(diagnosis.failed)} failed of ${String(diagnosis.checks.length)}`
  return [...lines, '', summary].join('\n')
}

/** What a credential looks like from the outside, with the value never leaving. */
export type SecretPresence = 'present' | 'absent' | 'unreadable'

/**
 * Report whether a secret is there — and nothing else about it.
 *
 * `unreadable` is its own state rather than folded into either neighbour: a file that exists but
 * cannot be read is neither present nor absent, and collapsing it sends the operator to the wrong
 * fix — provisioning a key they already have, or debugging a permission problem they do not have.
 *
 * An EMPTY value counts as absent. `OPENAI_API_KEY=` is how a key gets unset in practice, and
 * reporting it present sends an operator hunting for a network fault behind a 401.
 */
export function secretPresence(value: string | undefined | Error): SecretPresence {
  if (value instanceof Error) return 'unreadable'
  if (value === undefined || value === '') return 'absent'
  return 'present'
}
