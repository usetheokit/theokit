import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `--preset=bot` — layered ON TOP of the default template, never a second template.
 *
 * The distinction is the decision, and it is the one usetheokit/theokit#467 left open. A bot app and
 * a web app share almost everything: the shell, the config, the toolchain, the route conventions.
 * What differs is the ENTRY POINT — a schedule instead of a page — and the questions that follow
 * from nobody watching. A second full template would duplicate the ninety percent that is the same
 * and then drift, which is what `--surface` already avoids by layering.
 *
 * ## What it adds, and what each piece is answering
 *
 * | file | the question it answers |
 * |---|---|
 * | `agents/researcher.ts`, `agents/publisher.ts` | two bots, so "whose conversation is this" is a real question rather than an exercise |
 * | `agents/lib/bot-scope.ts` | the piece people rediscover: conversation id + tool confinement + workspace, composed once |
 * | `agents/lib/sandbox.ts` | the confinement default, stated rather than omitted |
 * | `agents/tools/*` | a write confined by a resolved path, and a read the other bot cannot write |
 * | `server/delivery.ts` | how an approval reaches you when nobody is attached |
 * | `server/crons/daily-research.ts` | the schedule that makes it a bot |
 *
 * ## Two bots, not three
 *
 * Two is where delegation and isolation become visible; three starts being a demo application. The
 * scaffold's job is to make the shape obvious, not to be the product.
 *
 * ## No delivery channel is wired
 *
 * `server/delivery.ts` prints. A default channel is a policy decision — an email address you did not
 * write, a workspace you may not have — and a scaffold that made it would be choosing for you. The
 * seam is present, called from the places that need it, with one commented example.
 */
export interface BotPresetOptions {
  /** Where the default template was already copied. */
  readonly targetDir: string
}

/** Files the preset owns, relative to its template root. Listed so a partial copy is detectable. */
const PRESET_FILES = [
  'agents/researcher.ts',
  'agents/publisher.ts',
  'agents/lib/bot-scope.ts',
  'agents/lib/sandbox.ts',
  'agents/tools/read-notes.ts',
  'agents/tools/write-note.ts',
  'agents/tools/publish.ts',
  'server/delivery.ts',
  'server/crons/daily-research.ts',
] as const

function presetRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../templates/_bot-preset')
}

/**
 * Copy the preset over an already-scaffolded default app.
 *
 * EC: callers MUST wrap this in the same try/catch + rollback the bare transform documents — a
 * partial layer leaves an app that references files it does not have.
 */
export function applyBotPreset(options: BotPresetOptions): void {
  const from = presetRoot()

  // Fail before writing anything, naming what is missing. A preset that copied four of nine files
  // and returned would produce an app whose agents import tools that are not there — an error the
  // developer meets at build time, three steps from the cause.
  const missing = PRESET_FILES.filter((f) => !existsSync(join(from, f)))
  if (missing.length > 0) {
    throw new Error(
      `--preset=bot is incomplete in this build: missing ${missing.join(', ')}. ` +
        'Refusing to scaffold a partial preset.',
    )
  }

  for (const file of PRESET_FILES) {
    cpSync(join(from, file), join(options.targetDir, file), { recursive: true })
  }

  // The chat agent stays: a bot app still benefits from a surface to talk to its bots through, and
  // removing it would make `--preset=bot` a different template rather than a layer over this one.
  appendBotReadme(options.targetDir)
}

/** A section, appended — the template's README is the app's, and this adds to it rather than replacing it. */
function appendBotReadme(targetDir: string): void {
  const path = join(targetDir, 'README.md')
  if (!existsSync(path)) return
  const current = readFileSync(path, 'utf-8')
  writeFileSync(path, `${current}\n${BOT_README_SECTION}`, 'utf-8')
}

const BOT_README_SECTION = `
## Bots (\`--preset=bot\`)

Two agents that work unattended:

- **researcher** — writes notes into its own workspace on a schedule
- **publisher** — reads those notes and publishes, behind a human approval

\`\`\`bash
# drive one directly
curl -X POST localhost:3000/api/agents/researcher \\
  -H 'content-type: application/json' -H 'X-Theo-Action: 1' \\
  -d '{"topic":"what changed in our dependencies this week"}'
\`\`\`

### What to change first

**\`server/delivery.ts\`** prints to the console. That is the honest local behaviour and the reason
the scaffold runs before you configure anything — but a bot whose approvals only print is a bot
nobody can approve. Point it at a channel you actually read; one commented example is in the file.

**\`server/crons/daily-research.ts\`** runs at 09:00 UTC. Cron schedules are UTC, not local.

### What is already decided for you

Each bot writes only inside \`.bots/<id>/\`, enforced by a resolved-path check rather than by asking
the model nicely. \`publisher\` can read the researcher's notes and cannot write them — that
asymmetry comes from \`botScope\`'s write root, so it holds even when a prompt says otherwise.

\`publish\` is gated by \`.approval()\`. On an attended run the surface shows the prompt; on a
scheduled one there is no attached client, which is what \`server/delivery.ts\` exists for.
`
