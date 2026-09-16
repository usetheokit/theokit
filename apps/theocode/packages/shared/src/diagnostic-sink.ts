import { installDiagnosticSink as installFrameworkSink } from '@theokit/agents/doctor'

/**
 * The diagnostics sink, reduced to the one thing that is genuinely ours: the variable name.
 *
 * The mechanism — read a destination, route to stderr or to a file, never take the run down when
 * that file cannot be written — moved to `@theokit/agents/doctor` and was deleted here. What could
 * not move is the KEY: the framework reads `THEOKIT_DIAGNOSTICS`, and this product's operators have
 * `THEOCODE_DIAGNOSTICS` in their shells and their scripts. Adopting the framework's name would be a
 * breaking change disguised as a refactor, and it would fail silently — diagnostics would simply
 * stop appearing, which is the worst way for a debugging aid to break.
 *
 * So this is the adapter the deletion ledger anticipated: the file survives, ~28 lines lighter, and
 * now states exactly which part of the old module was worth keeping.
 */
/**
 * Whether the last install actually turned diagnostics on.
 *
 * The answer was already computed on every install and every caller threw it away, so the failure
 * text could not tell an operator who had enabled diagnostics from one who had never heard of the
 * variable — and therefore could not name it without nagging the first group. Held at module scope
 * for the same reason `mcp-failure-record.ts` holds its sink there: there is one process, the value
 * changes at boot, and threading a boot fact through every call site would be ceremony.
 */
let enabled = false

/** Reads the state the last `installDiagnosticSink` produced. See `TurnErrorContext`. */
export function diagnosticsEnabled(): boolean {
  return enabled
}

export function installDiagnosticSink(
  install: (sink: ((m: string) => void) | undefined) => void,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const result = installFrameworkSink({
    // Translated, not forwarded. The framework's contract is stated in terms of its own key; handing
    // it this process's whole environment would have it read a variable nobody here sets.
    env: { THEOKIT_DIAGNOSTICS: env.THEOCODE_DIAGNOSTICS },
    install,
    onWarn: (message) => process.stderr.write(`diagnostics: ${message}\n`),
  })

  enabled = result.kind !== 'off'
  return enabled
}
