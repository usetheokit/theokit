/**
 * The `theokit generate schedule` generator.
 *
 * A schedule must land where `theokit build` scans (`<agentsDir>/schedules`), so its directory is
 * read from the project config through `loadConfig`, the same reader the build uses. When the
 * config cannot be read the generator refuses by name instead of guessing a directory.
 *
 * A schedule runs the app's `chat` agent, so a project without one is refused too: a schedule
 * importing a module that does not exist would make `theokit build` fail on it.
 *
 * The schedule declares `defineCron('<last segment of the name>')`, so that segment is checked with
 * `defineCron`'s own rule and the scanner's own discovery: a name the build would reject, skip, or
 * find already used by another cron file is refused as `invalid_name` before anything is written.
 */
import { existsSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'

import { loadConfig } from '../../config/load-config.js'
import { isDiscoverableCronFile, listCronFiles } from '../../server/cron/cron-scan.js'
import { CRON_NAME_RULE, isValidCronName } from '../../server/cron/define-cron.js'

import type { GenerateResult } from './generate-types.js'

/** The files a `chat` agent may live in, in lookup order. */
const CHAT_AGENT_FILES = ['chat.ts', 'chat.tsx', 'chat.js'] as const

/** Where the schedule goes and what it says, or the refusal that explains why it cannot be written. */
export async function resolveScheduleTarget(
  cwd: string,
  name: string,
): Promise<{ filePath: string; content: string } | GenerateResult> {
  const malformed = cronNameRefusal(name)
  if (malformed !== undefined) return malformed
  let config: Awaited<ReturnType<typeof loadConfig>>
  try {
    config = await loadConfig(cwd)
  } catch (err) {
    return {
      status: 'invalid_config',
      message: `Cannot read ${resolve(cwd, 'theo.config.ts')}: ${(err as Error).message}`,
    }
  }
  const { agentsDir, serverDir } = config
  const agentsRoot = resolve(cwd, agentsDir)
  const chatPath = CHAT_AGENT_FILES.map((file) => resolve(agentsRoot, file)).find((path) =>
    existsSync(path),
  )
  if (chatPath === undefined) {
    return {
      status: 'agent_not_found',
      message:
        `No "chat" agent in ${agentsRoot} (looked for ${CHAT_AGENT_FILES.join(', ')}). ` +
        'A schedule runs the chat agent; create it first.',
    }
  }
  const filePath = resolve(agentsRoot, 'schedules', `${name}.ts`)
  // The build scans both homes with one duplicate-name guard (build.ts, emitCronArtifacts).
  const cronDirs = [resolve(cwd, serverDir, 'crons'), resolve(agentsRoot, 'schedules')]
  const taken = cronNameTaken(name, filePath, cronDirs)
  if (taken !== undefined) return taken
  return { filePath, content: generateScheduleTemplate(name, importSpecifier(filePath, chatPath)) }
}

/** The cron name a schedule called `name` declares: its last `/` segment. */
function cronNameOf(name: string): string {
  return name.split('/').pop() ?? name
}

/** A refusal when the build would skip the file or `defineCron` would reject its name. */
function cronNameRefusal(name: string): GenerateResult | undefined {
  const cronName = cronNameOf(name)
  if (!isDiscoverableCronFile(`${cronName}.ts`)) {
    return {
      status: 'invalid_name',
      message: `Invalid schedule name "${name}": the build does not discover a cron file named "${cronName}.ts".`,
    }
  }
  if (!isValidCronName(cronName)) {
    return {
      status: 'invalid_name',
      message: `Invalid schedule name "${name}": its cron name "${cronName}" is one defineCron rejects. ${CRON_NAME_RULE}`,
    }
  }
  return undefined
}

/**
 * A refusal when another cron file already carries this schedule's cron name. The generator names
 * a cron after its file, so a file of the same name in either cron home is the clash the build's
 * duplicate-name guard would fail on. The target itself is left to the `already_exists` answer.
 */
function cronNameTaken(
  name: string,
  filePath: string,
  cronDirs: readonly string[],
): GenerateResult | undefined {
  const cronName = cronNameOf(name)
  const clash = listCronFiles(cronDirs).find(
    (path) => path !== filePath && basename(path, extname(path)) === cronName,
  )
  if (clash === undefined) return undefined
  return {
    status: 'invalid_name',
    message: `Invalid schedule name "${name}": the cron name "${cronName}" is already used by ${clash}. Cron names must be unique across server/crons/ and agents/schedules/.`,
  }
}

/** The ESM specifier the schedule at `fromFile` uses to import `toFile` (`../chat.js`). */
function importSpecifier(fromFile: string, toFile: string): string {
  const path = relative(dirname(fromFile), toFile)
    .split(sep)
    .join('/')
    .replace(/\.(ts|tsx|js)$/, '.js')
  return path.startsWith('.') ? path : `./${path}`
}

function generateScheduleTemplate(name: string, chatSpecifier: string): string {
  const base = cronNameOf(name)
  return [
    `import { defineCron } from 'theokit/server/cron'`,
    `import { resolveProvider } from 'theokit/server/agent'`,
    `import { streamAgentTurnInProcess } from '@theokit/agents'`,
    ``,
    `import chat from '${chatSpecifier}'`,
    ``,
    `/**`,
    ` * A scheduled agent run, a first-class TheoKit cron. \`theokit build\` discovers it and translates the`,
    ` * schedule to your deploy target's native cron; \`theokit start\` runs it in-process.`,
    ` *`,
    ` * Each fire is one model run of your \`chat\` agent, so it spends tokens. Nobody is present to approve`,
    ` * a gated tool, so the run uses the \`auto-reject\` posture: every approval is answered "no" and the`,
    ` * gated tool does not run.`,
    ` *`,
    ` * Schedules are UTC (https://crontab.guru). \`signal\` aborts when the scheduler stops.`,
    ` */`,
    `export default defineCron('${base}', {`,
    `  schedule: '0 9 * * *', // every day at 09:00 UTC`,
    `  async handler({ traceId, scheduledAt, signal }) {`,
    `    let outcome = 'ok'`,
    `    try {`,
    `      const agent = chat as { model?: string; plugins?: readonly unknown[] }`,
    `      const { apiKey } = resolveProvider(agent.model, { plugins: agent.plugins })`,
    `      const run = streamAgentTurnInProcess(chat, apiKey, {`,
    `        message: \`Scheduled run "${base}" at \${scheduledAt.toISOString()}\`,`,
    `        signal,`,
    `        approvals: {`,
    `          kind: 'auto-reject',`,
    `          reason: 'unattended schedule "${base}": nobody is present to approve',`,
    `        },`,
    `      })`,
    `      for await (const chunk of run) {`,
    `        // The SDK can report a failed run as a chunk rather than a rejection.`,
    `        if (chunk.type === 'error') {`,
    `          throw new Error(\`[${base}] agent run failed: \${chunk.errorText ?? 'no error text'}\`)`,
    `        }`,
    `      }`,
    `    } catch (err) {`,
    `      outcome = \`failed: \${err instanceof Error ? err.message : String(err)}\``,
    `      throw err`,
    `    } finally {`,
    `      // One traced line per fire, failed fires included: the scheduler's own error line has no trace id.`,
    `      console.log(\`[${base}] fire \${outcome} at \${scheduledAt.toISOString()} (trace \${traceId})\`)`,
    `    }`,
    `  },`,
    `})`,
    ``,
  ].join('\n')
}
