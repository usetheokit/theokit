import { tool } from 'theokit/server/define'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import { botScope } from '../lib/bot-scope.js'
import { workspaceSandbox } from '../lib/sandbox.js'

/**
 * Read the researcher's notes. Both bots use this, and only one can write them.
 *
 * That asymmetry is the multi-bot shape in one file: `publisher` reads a workspace it has no write
 * root for, so "the publisher cannot edit the research" is enforced by `botScope` rather than by
 * instructions the model may ignore.
 */
export const readNotesTool = tool('read_notes')
  .describe("Read the researcher bot's notes.")
  .input(z.object({}))
  .execute(async () => {
    const scope = botScope({
      botId: 'researcher',
      projectRoot: process.cwd(),
      sandbox: workspaceSandbox(),
    })
    // An empty workspace is a normal state on a first run, not an error: the researcher may simply
    // not have run yet. Saying so beats an ENOENT the model has to interpret.
    const names = await readdir(scope.workspace).catch(() => [] as string[])
    if (names.length === 0) return 'No notes yet — the researcher has not written any.'
    const notes = await Promise.all(
      names.map(async (n) => `## ${n}\n${await readFile(join(scope.workspace, n), 'utf-8')}`),
    )
    return notes.join('\n\n')
  })
  .build()
