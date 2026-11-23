import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { addMemoryFact, listMemoryFacts } from '@theokit/sdk'

import { OWNER_SCOPE } from './memory-store.js'
import { userIdOf } from './wiring.js'

/** Where earlier versions kept `facts.jsonl`: under the workspace. */
export function legacyFactsFile(workspace: string): string {
  return join(workspace, '.theoclaw', 'memory', 'facts.jsonl')
}

/** The facts earlier versions kept for `scope` (rows without a scope belong to the owner), oldest first. */
export function legacyFacts(file: string, scope: string): string[] {
  if (!existsSync(file)) return []
  const out: string[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      const row = JSON.parse(line) as { fact?: unknown; scope?: unknown }
      const rowScope = typeof row.scope === 'string' ? row.scope : OWNER_SCOPE
      if (typeof row.fact === 'string' && row.fact.trim() !== '' && rowScope === scope)
        out.push(row.fact.trim())
    } catch {
      // A blank or torn line is skipped, as the old store did.
    }
  }
  return out
}

/**
 * Copies the facts the old `facts.jsonl` holds for `scope` into the SDK partition of that scope, those not
 * already there. The old file is left in place; a failure goes to `report` and never stops the session.
 */
export async function importLegacyFacts(
  file: string,
  directory: string,
  scope: string,
  report: (line: string) => void,
): Promise<void> {
  try {
    const wanted = legacyFacts(file, scope)
    if (wanted.length === 0) return
    const config = { enabled: true, directory, userId: userIdOf(scope) }
    const have = new Set((await listMemoryFacts(directory, config)).map((fact) => fact.text))
    for (const text of wanted) {
      if (have.has(text)) continue
      have.add(text)
      await addMemoryFact(directory, text, config)
    }
  } catch (error) {
    report(`theoclaw: importing earlier memory facts failed: ${String(error)}`)
  }
}
