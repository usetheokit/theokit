/**
 * The `theokit generate schedule` generator.
 *
 * A schedule must land where `theokit build` scans (`<agentsDir>/schedules`), so its directory is
 * read from the project config through `loadConfig`, the same reader the build uses. When the
 * config cannot be read the generator refuses by name instead of guessing a directory.
 */
import { resolve } from 'node:path'

import { loadConfig } from '../../config/load-config.js'

import type { GenerateResult } from './generate-types.js'

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
  return {
    filePath: resolve(cwd, agentsDir, 'schedules', `${name}.ts`),
    content: generateScheduleTemplate(name),
  }
}

function generateScheduleTemplate(name: string): string {
  const base = name.split('/').pop() ?? name
  return [
    `import { defineCron } from 'theokit/server/cron'`,
    ``,
    `/**`,
    ` * A scheduled agent run — a first-class TheoKit cron. \`theokit build\` discovers it automatically and`,
    ` * translates the schedule to your deploy target's native cron (Vercel / Cloudflare / AWS). No manual`,
    ` * scheduler to start. The handler is where you invoke your agent — POST to \`/api/agents/chat\`, or use`,
    ` * \`@theokit/sdk\`'s \`Agent\` with the same model + system prompt as \`agents/chat.ts\`.`,
    ` *`,
    ` * Schedules are UTC (https://crontab.guru). \`signal\` aborts when the scheduler stops.`,
    ` */`,
    `export default defineCron('${base}', {`,
    `  schedule: '0 9 * * *', // every day at 09:00 UTC`,
    `  async handler({ traceId, scheduledAt, signal }) {`,
    `    void signal`,
    `    // Invoke your agent here — e.g. fetch your own \`/api/agents/chat\` endpoint, or call the SDK Agent.`,
    `    console.log(\`[${base}] fired at \${scheduledAt.toISOString()} (trace \${traceId})\`)`,
    `  },`,
    `})`,
    ``,
  ].join('\n')
}
