/**
 * `@theokit/agents/doctor` — M84: the mechanism for a resolved-state report.
 *
 * A subpath by the rule the M76/M82/M83 bundle findings established: an app that only defines an
 * agent should not carry a diagnostic renderer.
 *
 * The LIST of checks stays the product's. What is here is the quartet every product re-derives
 * identically — and the hard rule that a credential is reported as present/absent/unreadable and
 * never as a value, because a doctor that prints secrets is a doctor nobody can paste into an issue.
 */
export { diagnose, renderDiagnosis, secretPresence } from './diagnose.js'
export type { Check, Diagnosis, SecretPresence } from './diagnose.js'

export { installDiagnosticSink } from './diagnostic-sink.js'
export type { DiagnosticDestination, InstallDiagnosticSinkOptions } from './diagnostic-sink.js'
