/**
 * B-081 — `theocode doctor`.
 *
 * Reports the RESOLVED state, not the config files: the gap between what config asks for and what
 * the product does is the failure class being diagnosed, so re-printing config would answer the
 * wrong question. The wiring half comes from the record `buildChatAgent` publishes — the same
 * source `/mcp`, `/skills` and `/hooks` read, so a support session and the TUI cannot disagree.
 *
 * Exits non-zero on a failure so it is usable in a script, and never prints a credential value.
 */
import process from 'node:process'
import { homedir } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'

// From the package entry, not `@theocode/agent/doctor`: that subpath is NOT in the package's
// `exports` map, and `tsconfig.json` maps `@theocode/agent/*` straight onto `src/*` — so TypeScript
// resolves it happily and the bundle would fail at runtime. README.md names this exact trap.
import type { CredentialState } from '@theocode/agent'

/** Presence only — the file is opened to tell "absent" from "corrupt", never to read a secret. */
/**
 * What the stored credential is, WITHOUT reading its value.
 *
 * The expiry check is the point. Parsing the file and returning `present` reported `✓ credential:
 * present` for an OAuth token ten days past its expiry (measured 2026-08-25) — a green tick on the
 * one thing that was going to fail first.
 *
 * `expires` is optional and its absence is not expiry: an API-key credential has no expiry at all,
 * and treating a missing field as expired would warn every key user about a problem they cannot
 * have. Only a number in the past counts. `now` is injected so the boundary is testable without
 * waiting for a real token to age.
 */
/**
 * The shape every stored credential has, whichever kind it is.
 *
 * `StoredOAuthCredential` declares `provider`, and the message this product prints when no
 * credential is found tells the operator to write `{"provider": "openrouter", "api_key": "..."}`.
 * The two forms share exactly one field, so that field is the floor — nothing here invents a
 * contract, it reads the one the product already states in two places.
 *
 * Deliberately NOT stricter. Demanding `access`/`api_key` would make this file the second authority
 * on what a credential is, and the first one lives in the framework; a `doctor` that refuses what
 * the loader accepts is the same defect pointed the other way.
 */
function looksLikeACredential(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
  const provider: unknown = (parsed as { provider?: unknown }).provider
  return typeof provider === 'string' && provider !== ''
}

export function credentialState(path: string, now: number = Date.now()): CredentialState {
  if (!existsSync(path)) return 'absent'
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return 'unreadable'
  }
  // #823 — parsing is not the same question as being a credential. `{"nao":"e-credencial"}` is valid
  // JSON, so this returned `present` while the TUI, which tries to USE the file, showed `none`.
  // Measured 2026-09-17 against a decoy: the diagnostic an operator opens BECAUSE a session will not
  // authenticate was the one saying everything was fine.
  if (!looksLikeACredential(parsed)) return 'unreadable'
  const expires = (parsed as { expires?: unknown }).expires
  return typeof expires === 'number' && expires <= now ? 'expired' : 'present'
}

export async function doctorCommand(opts: { json: boolean; cd?: string }): Promise<void> {
  const agent = await import('@theocode/agent')
  const { authFilePath, strayCredentialFiles } = await import('@theocode/agent/auth')
  const { skillsOnDisk, loadOutputStyle, foreignHookRefusals } = await import('@theocode/agent')
  const { resolveEffectiveConfig, resolveTrustPosture, settingsReport } = await import(
    '@theocode/agent/config'
  )
  const cwd = opts.cd ?? process.cwd()

  const posture = resolveTrustPosture(cwd)
  const cfg = resolveEffectiveConfig({ cwd })

  // Built for real, so the wiring reported is the wiring an actual turn would get. A cheaper
  // "read the files again" would reproduce the defect B-071 was reopened for.
  let wired = agent.wiredCapabilities({
    posture,
    projectSourcesAllowed: false,
    mcpServers: {},
    configuredSkills: [],
    hookEvents: [],
    agentsMdFiles: [],
    sandboxMode: cfg.sandbox_mode,
  })
  agent.buildChatAgent({ cwd, surface: 'headless', onWired: (w) => (wired = w) })

  const { AGENT } = await import('@theocode/shared/agent')
  const checks = agent.collectChecks({
    cwd,
    // #128 — the one fact every bug report asks for, from the literal `agent.test.ts` holds against
    // the manifest. Reading the manifest here would be a second answer to one question.
    version: AGENT.version,
    trustLevel: posture.level,
    model: cfg.model,
    effort: cfg.reasoning_effort,
    sandboxMode: cfg.sandbox_mode,
    approvalPolicy: cfg.approval_policy,
    // B-081 — resolved through `authFilePath`, the product's own function, and handed the same env
    // it reads. MEASURED, not assumed: with the current store `~/.theocode/auth.json` is the answer
    // either way, but computing the path a second way here would be the divergence a diagnostic
    // must never introduce — it would report on a file the product does not use.
    credential: credentialState(authFilePath(homedir(), process.env)),
    // #72 — the split between our two state directories left a credential behind once already:
    // `~/.theokit/auth.json`, written by the SDK before `installAuthHome` pointed it at ours, then
    // read by nothing and rotated by nothing. The store is deliberately NOT moved — that is the one
    // step of the unification that can log an operator out — so the leftover is made visible.
    strayCredentials: strayCredentialFiles(homedir(), process.env),
    // #67 — the skills row is the DECLARED list, so it ticked green for a name with no SKILL.md and
    // said nothing about a file no configuration named. This holds the two against each other.
    skillsOnDisk: skillsOnDisk(cwd, cfg.skills),
    // B-175 — the four foreign surfaces no check named. Measured here rather than inside
    // `collectChecks`, which does no I/O by design, exactly like `skillsOnDisk` above it.
    foreignSurfaces: agent.foreignSurfacesOnDisk(cwd),
    // #130 — read here rather than inside `collectChecks`, which does no I/O by design. The
    // framework loads these files itself and spawns what it finds; this product refuses, and until
    // now said so nowhere for `.theokit/hooks.json`.
    foreignHooks: foreignHookRefusals(cwd, {
      exists: existsSync,
      read: (p) => readFileSync(p, 'utf8'),
    }),
    // `settings.json` wears Claude Code's filename, so the file often carries their settings. The
    // loader tolerates them — a real one must not stop the product from starting — and this row is
    // the other half of that trade: a key we ignore has to be nameable somewhere.
    settingsIgnored: settingsReport({ projectDir: cwd }),
    // Resolved through the product's own loader, not by a second existsSync here — a diagnostic that
    // recomputes what it reports on eventually reports on a file the product does not read.
    ...(cfg.output_style !== undefined
      ? {
          outputStyle: {
            name: cfg.output_style,
            resolved: loadOutputStyle(cfg.output_style, { project: cwd }) !== null,
          },
        }
      : {}),
    wired,
  })
  const result = agent.diagnose(checks)

  if (opts.json) process.stdout.write(`${JSON.stringify({ type: 'doctor', ...result })}\n`)
  else process.stderr.write(`${agent.renderDiagnosis(result)}\n`)
  // `result.exitCode`, not `result.failed ? 1 : 0`. The framework's diagnosis computes it, and it
  // carries a case the local version could not express: an EMPTY check list exits non-zero, because
  // "no checks ran" is a different fact from "everything passed" — and the boolean collapsed them.
  process.exit(result.exitCode)
}
