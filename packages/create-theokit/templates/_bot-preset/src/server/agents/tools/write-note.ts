import { tool } from 'theokit/server/define'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'

import { botScope } from '../lib/bot-scope.js'
import { workspaceSandbox } from '../lib/sandbox.js'

/**
 * Write a note into THIS bot's workspace — and nowhere else.
 *
 * The confinement is the interesting part, and it is not the prompt's job. `botScope` derives a
 * `writeRoot` per bot; this resolves the caller's path against it and refuses anything that escapes.
 * A model asked politely not to write outside its folder is a request; a resolved-path check is a
 * wall.
 */
export const writeNoteTool = tool('write_note')
  .describe('Write a research note into your own workspace. Paths are relative to it.')
  .input(
    z.object({
      path: z.string().describe('Relative path for the note, e.g. "topic/summary.md".'),
      content: z.string().describe('The note body.'),
    }),
  )
  .execute(async ({ path, content }) => {
    const scope = botScope({
      botId: 'researcher',
      projectRoot: process.cwd(),
      sandbox: workspaceSandbox(),
    })
    const target = resolve(join(scope.workspace, path))
    // Fail fast, fail clear: name what was refused and why, rather than writing somewhere surprising.
    if (!target.startsWith(resolve(scope.workspace))) {
      throw new Error(
        `write_note: "${path}" resolves outside this bot's workspace (${scope.workspace}). ` +
          'A bot writes only its own work; use a relative path.',
      )
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf-8')
    return `Wrote ${path}`
  })
  .build()
