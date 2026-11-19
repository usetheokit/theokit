/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time adapter translators: caller-controlled paths only.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, sep } from 'node:path'

import { writeAtomic } from '../_internal/atomic-write.js'

import type { CronManifestEntry } from './cron-manifest.js'

/**
 * Thrown when an existing platform-config file (vercel.json, wrangler.toml,
 * serverless.yml) cannot be parsed. Caller must fix the file before
 * re-running `theokit build`. We NEVER silently overwrite a user's config.
 */
export class ExistingConfigUnparseableError extends Error {
  readonly code = 'EXISTING_CONFIG_UNPARSEABLE'
  constructor(
    public readonly filePath: string,
    public readonly parseError: string,
  ) {
    super(
      `Existing config "${filePath}" could not be parsed: ${parseError}. ` +
        'Fix or remove the file before re-running build — TheoKit never silently overwrites user configuration.',
    )
    this.name = 'ExistingConfigUnparseableError'
  }
}

// ──────────────────────────────────────────────────────────
// Vercel — vercel.json crons[]
// ──────────────────────────────────────────────────────────

interface VercelJson {
  crons?: { path: string; schedule: string }[]
  [key: string]: unknown
}

/**
 * Translate a TheoKit cron manifest into `vercel.json crons[]`.
 *
 * EC-105: existing fields (functions, headers, redirects, rewrites, env,
 * etc.) are preserved verbatim — ONLY the `crons[]` slice is replaced.
 */
export function translateCronToVercel(
  vercelJsonPath: string,
  crons: readonly CronManifestEntry[],
): void {
  let existing: VercelJson = {}
  if (existsSync(vercelJsonPath)) {
    const raw = readFileSync(vercelJsonPath, 'utf8')
    try {
      existing = JSON.parse(raw) as VercelJson
    } catch (err) {
      throw new ExistingConfigUnparseableError(
        vercelJsonPath,
        err instanceof Error ? err.message : String(err),
      )
    }
  }
  const merged: VercelJson = {
    ...existing,
    crons: crons.map((c) => ({
      path: `/api/__crons/${c.name}`,
      schedule: c.schedule,
    })),
  }
  writeAtomic(vercelJsonPath, JSON.stringify(merged, null, 2))
}

// ──────────────────────────────────────────────────────────
// Cloudflare — wrangler.toml [triggers] crons
// ──────────────────────────────────────────────────────────

/**
 * Translate a TheoKit cron manifest into `wrangler.toml [triggers] crons`.
 *
 * EC-105: regex-based mutation that preserves comments + other sections
 * verbatim. Replaces only the `[triggers]` block (or appends if absent).
 */
export function translateCronToCloudflare(
  wranglerTomlPath: string,
  crons: readonly CronManifestEntry[],
): void {
  const schedules = crons.map((c) => `"${c.schedule}"`).join(', ')
  const triggersBlock = `[triggers]\ncrons = [${schedules}]\n`

  if (!existsSync(wranglerTomlPath)) {
    writeAtomic(wranglerTomlPath, triggersBlock)
    return
  }

  const existing = readFileSync(wranglerTomlPath, 'utf8')

  // Replace existing [triggers] section if present. Strategy: split into
  // line array, find the [triggers] header line, drop subsequent lines
  // until the next section header (line starting with `[`) or EOF.
  const lines = existing.split('\n')
  const triggersIdx = lines.findIndex((l) => l.trim() === '[triggers]')

  let next: string
  if (triggersIdx !== -1) {
    let endIdx = lines.length
    for (let i = triggersIdx + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('[')) {
        endIdx = i
        break
      }
    }
    const before = lines.slice(0, triggersIdx).join('\n')
    const after = lines.slice(endIdx).join('\n')
    next = `${before}\n${triggersBlock.trimEnd()}\n${after}`.replace(/\n{3,}/g, '\n\n')
  } else {
    next = existing.endsWith('\n')
      ? `${existing}\n${triggersBlock}`
      : `${existing}\n\n${triggersBlock}`
  }
  writeAtomic(wranglerTomlPath, next)
}

// ──────────────────────────────────────────────────────────
// AWS Lambda — serverless.yml functions.<fn>.events: schedule
// ──────────────────────────────────────────────────────────

/**
 * Convert TheoKit's 5-field UTC cron to AWS EventBridge's 6-field format.
 * EventBridge requires `?` in EITHER day-of-month OR day-of-week (not both `*`).
 *
 * Algorithm:
 *   - If DOM is "*" and DOW is "*" → insert ? in DOW (default)
 *   - If DOM is "*" and DOW is specific → insert ? in DOM
 *   - If DOM is specific and DOW is "*" → insert ? in DOW
 *   - Append "*" year field at end.
 */
export function convertToAwsCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid 5-field schedule for AWS conversion: "${schedule}"`)
  }
  const [minute, hour, dom, month, dow] = parts
  let awsDom = dom
  let awsDow = dow
  if (dom === '*' && dow === '*') {
    awsDow = '?'
  } else if (dom === '*') {
    awsDom = '?'
  } else if (dow === '*') {
    awsDow = '?'
  }
  return `cron(${minute} ${hour} ${awsDom} ${month} ${awsDow} *)`
}

/**
 * Translate a TheoKit cron manifest into a `serverless.yml` functions
 * map with `events: - schedule: cron(...)` entries.
 *
 * EC-105: appends to `functions:` block, preserving all existing
 * functions/sections. Cron functions are named `cron_<name>` to avoid
 * collision with user-declared functions.
 */
export function translateCronToAws(
  serverlessYmlPath: string,
  crons: readonly CronManifestEntry[],
): void {
  const cronFunctionsYaml = crons
    .map(
      (c) => `  cron_${c.name}:
    handler: .theokit/server/crons/${c.name}.handler
    events:
      - schedule: ${convertToAwsCron(c.schedule)}`,
    )
    .join('\n')

  const block = `\nfunctions:\n${cronFunctionsYaml}\n`

  if (!existsSync(serverlessYmlPath)) {
    // Minimal serverless.yml scaffold
    writeAtomic(
      serverlessYmlPath,
      `service: theokit-app\nprovider:\n  name: aws\n  runtime: nodejs22.x\n${block}`,
    )
    return
  }

  const existing = readFileSync(serverlessYmlPath, 'utf8')

  // Look for an existing top-level `functions:` block; if present, append our
  // cron entries under it (don't replace user-declared functions).
  const functionsRe = /^functions:\s*\n/m
  let next: string
  if (functionsRe.test(existing)) {
    next = existing.replace(functionsRe, (match) => `${match}${cronFunctionsYaml}\n`)
  } else {
    next = existing.endsWith('\n') ? `${existing}${block}` : `${existing}\n${block}`
  }
  writeAtomic(serverlessYmlPath, next)
}

// ──────────────────────────────────────────────────────────
// Deno Deploy — Deno.cron registrations
// ──────────────────────────────────────────────────────────

/**
 * Emit a Deno entry file that registers each cron via `Deno.cron`.
 *
 * Unlike Vercel/CF/AWS, Deno.cron is an in-process runtime API — the
 * entry file is a managed artifact (overwritten each build), not a user
 * config (so EC-105 doesn't apply here).
 */
export interface DenoCronOptions {
  /** Project root; module paths in the entry are relative to the entry's directory. Default: its parent. */
  projectRoot?: string
  /** Config modules, base first then the environment override, merged as `loadConfig` does. */
  configPaths?: readonly string[]
  /** The theokit version the project builds with; the entry imports exactly that release. */
  theokitVersion?: string
}

/** A module specifier from the entry's directory to `target`, always relative. */
function relativeSpecifier(fromDir: string, target: string): string {
  const rel = relative(fromDir, target).split(sep).join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

export function translateCronToDeno(
  entryPath: string,
  crons: readonly CronManifestEntry[],
  opts: DenoCronOptions = {},
): void {
  const entryDir = dirname(entryPath)
  const root = opts.projectRoot === undefined ? '..' : relativeSpecifier(entryDir, opts.projectRoot)
  const configs = (opts.configPaths ?? []).map((p) => relativeSpecifier(entryDir, p))
  // Unversioned `npm:theokit` would resolve a registry release unrelated to the one that built this.
  const pin = opts.theokitVersion ? `@${opts.theokitVersion}` : ''
  const jobsSpecifier = `npm:theokit${pin}/server/jobs`
  const lines = crons.map(
    (c) =>
      `Deno.cron("${c.name}", "${c.schedule}", async () => {
  const mod = await import("${root}/${c.filePath}");
  await runCron(mod.default);
});`,
  )
  const content = `// AUTOGENERATED by TheoKit cron build — DO NOT EDIT.
// Source: server/crons/*.ts → .theokit/crons.json → this file.
import { createOutbox, createQueueClient, createOutboxDispatcher } from "${jobsSpecifier}";

const CONFIG_MODULES: string[] = ${JSON.stringify(configs)};

// Merge as loadConfig's deepMerge does: plain objects merge key by key, anything else is replaced.
function mergeEffective(base, over) {
  const isRec = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const out = { ...base };
  for (const key of Object.keys(over)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    out[key] = isRec(over[key]) && isRec(base[key]) ? mergeEffective(base[key], over[key]) : over[key];
  }
  return out;
}

// The effective config's \`jobs.backend\`: configs merged base first, as in loadConfig.
async function loadBackend() {
  let merged = {};
  for (const spec of CONFIG_MODULES) {
    const mod = await import(spec);
    const cfg = mod.default?.default ?? mod.default;
    if (cfg !== null && typeof cfg === "object") merged = mergeEffective(merged, cfg);
  }
  return merged.jobs?.backend;
}

async function runCron(def: { handler: (ctx: unknown) => unknown }) {
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const backend = await loadBackend();
  const outbox = createOutbox();
  const queue = backend
    ? createQueueClient(backend, outbox, { traceparent: \`00-\${traceId}-\${spanId}-01\` })
    : undefined;
  try {
    await def.handler({
      traceId,
      scheduledAt: new Date(),
      signal: AbortSignal.timeout(60_000),
      queue,
    });
  } catch (err) {
    outbox.discard();
    throw err;
  }
  if (backend) await outbox.flush(createOutboxDispatcher(backend));
}

${lines.join('\n\n')}
`
  writeAtomic(entryPath, content)
}
