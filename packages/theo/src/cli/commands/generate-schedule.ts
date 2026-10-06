/**
 * The `theokit generate schedule` generator.
 *
 * A schedule must land where `theokit build` scans (`<agentsDir>/schedules`), so its directory is
 * read from the project config through `loadConfig`, the same reader the build uses. When the
 * config cannot be read the generator refuses by name instead of guessing a directory.
 *
 * A schedule runs the app's `chat` agent, so a project without one is refused too: a schedule
 * importing a module that does not exist would make `theokit build` fail on it.
 */
import { existsSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

import { loadConfig } from '../../config/load-config.js'

import type { GenerateResult } from './generate-types.js'

/** The files a `chat` agent may live in, in lookup order. */
const CHAT_AGENT_FILES = ['chat.ts', 'chat.tsx', 'chat.js'] as const

/** Where the schedule goes and what it says, or the refusal that explains why it cannot be written. */
export async function resolveScheduleTarget(
  cwd: string,
  name: string,
): Promise<{ filePath: string; content: string } | GenerateResult> {
  let agentsDir: string
  try {
    agentsDir = (await loadConfig(cwd)).agentsDir
  } catch (err) {
    return {
      status: 'invalid_config',
      message: `Cannot read ${resolve(cwd, 'theo.config.ts')}: ${(err as Error).message}`,
    }
  }
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
  return { filePath, content: generateScheduleTemplate(name, importSpecifier(filePath, chatPath)) }
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
  const base = name.split('/').pop() ?? name
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
    `    const agent = chat as { model?: string; plugins?: readonly unknown[] }`,
    `    const { apiKey } = resolveProvider(agent.model, { plugins: agent.plugins })`,
    `    const run = streamAgentTurnInProcess(chat, apiKey, {`,
    `      message: \`Scheduled run "${base}" at \${scheduledAt.toISOString()}\`,`,
    `      signal,`,
    `      approvals: {`,
    `        kind: 'auto-reject',`,
    `        reason: 'unattended schedule "${base}": nobody is present to approve',`,
    `      },`,
    `    })`,
    `    for await (const chunk of run) void chunk`,
    `    console.log(\`[${base}] fire ok at \${scheduledAt.toISOString()} (trace \${traceId})\`)`,
    `  },`,
    `})`,
    ``,
  ].join('\n')
}
