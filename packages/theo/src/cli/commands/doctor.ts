import { diagnose, renderDiagnosis, secretPresence, type Check } from '@theokit/agents/doctor'

/**
 * M84 — `theokit doctor`: what will this installation actually DO?
 *
 * `theokit info` answers "does my project parse?". That is not the question an agent product has.
 * The question is which credential will be used, which MCP servers will start, which skills exist —
 * the RESOLVED state, not the declared one.
 *
 * ## Never prints a secret
 *
 * Enforced by `secretPresence` from the primitive: present / absent / unreadable, never a value, a
 * prefix, a truncation or a length. A doctor that printed secrets would be the one command built for
 * support that you must not paste into a support request.
 *
 * ## The list lives here, the mechanism does not
 *
 * `diagnose` / `renderDiagnosis` / `Check` come from `@theokit/agents/doctor`, because every product
 * re-derives them identically. WHICH checks to run is what differs per product — so this file holds
 * the framework's own list, and a product composes its own on top.
 */

export interface DoctorDeps {
  readonly projectRoot?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Where the report goes. Injected so the suite never writes to the real stdout. */
  readonly write?: (text: string) => void
  /** Extra checks a product contributes. Appended after the framework's own. */
  readonly extraChecks?: readonly Check[]
}

/** The credential the run will use, reported WITHOUT its value. */
function credentialCheck(env: Readonly<Record<string, string | undefined>>): Check {
  const candidates = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const
  const found = candidates.find((name) => secretPresence(env[name]) === 'present')
  return found === undefined
    ? {
        name: 'credential',
        status: 'fail',
        detail:
          'absent — set one of OPENROUTER_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY, or run `theokit auth login`',
      }
    : { name: 'credential', status: 'ok', detail: `${found}: ${secretPresence(env[found])}` }
}

/** Whether an `.mcp.json` is present, and whether it parses. */
async function mcpCheck(projectRoot: string): Promise<Check> {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  try {
    const raw = await readFile(join(projectRoot, '.mcp.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const count = Object.keys((parsed as { mcpServers?: object }).mcpServers ?? {}).length
    return { name: 'mcp', status: 'ok', detail: `${String(count)} server(s) configured` }
  } catch (error) {
    // An absent file is the common case and NOT a failure — most projects use no MCP server. A file
    // that exists and does not parse IS a failure, because the operator believes it is in effect.
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { name: 'mcp', status: 'warn', detail: 'no .mcp.json — no MCP servers will start' }
      : {
          name: 'mcp',
          status: 'fail',
          detail: `.mcp.json is unreadable: ${(error as Error).message}`,
        }
  }
}

/** Whether `.theokit/agents/*.md` defines any subagent. */
async function subagentCheck(projectRoot: string): Promise<Check> {
  const { listSubagentNames } = await import('@theokit/agents')
  const names = await listSubagentNames(projectRoot)
  return names.length === 0
    ? { name: 'subagents', status: 'warn', detail: 'none defined in .theokit/agents/' }
    : { name: 'subagents', status: 'ok', detail: names.join(', ') }
}

/**
 * Run the framework's checks and report.
 *
 * Returns the exit code rather than calling `process.exit`: a command that exits cannot be tested,
 * and a doctor nobody ran is the one thing worse than no doctor.
 */
export async function doctorCommand(deps: DoctorDeps = {}): Promise<number> {
  const projectRoot = deps.projectRoot ?? process.cwd()
  const env = deps.env ?? process.env
  const write =
    deps.write ??
    ((text: string) => {
      process.stdout.write(`${text}\n`)
    })

  const checks: Check[] = [
    credentialCheck(env),
    await mcpCheck(projectRoot),
    await subagentCheck(projectRoot),
    ...(deps.extraChecks ?? []),
  ]

  const diagnosis = diagnose(checks)
  write(renderDiagnosis(diagnosis))
  return diagnosis.exitCode
}
