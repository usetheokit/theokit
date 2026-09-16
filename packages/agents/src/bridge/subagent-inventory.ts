import { discoverSubagents, type DiscoverSubagentsOptions } from '@theokit/sdk/subagents-loader'

import { explainSubagentMemoryRefusal, installedSdkVersion } from './sdk-adapter-create-options.js'

/**
 * M81 — the names of the subagents defined under `<cwd>/.theokit/agents/*.md`.
 *
 * ## Why one line deserves to exist
 *
 * It is a SELECTOR over `discoverSubagents`, exactly as `loadSubagentDefinition` already is — and
 * that module says why in its own words: *"one parser is the whole point"*.
 *
 * What was missing is not the logic; it is the REACH. A product that wants an inventory of
 * subagents for a `/agents` command had no name-shaped answer to reach for, so it wrote a second
 * reader over the same directory. Two readers of one convention disagree eventually — about
 * frontmatter, about which files count, about what an absent directory means — and the disagreement
 * shows up as a command that lists an agent the runtime cannot find.
 *
 * Sorted, because an inventory whose order changes per filesystem is an inventory nobody can diff.
 */
export async function listSubagentNames(
  cwd: string,
  options?: DiscoverSubagentsOptions,
): Promise<readonly string[]> {
  try {
    const discovered = await discoverSubagents(cwd, options)
    return Object.keys(discovered).sort((a, b) => a.localeCompare(b))
  } catch (error) {
    // The SDK refuses `memory:` before 5.9.0 with a message naming the FIELD and the keys it
    // accepts — which reads as a typo, so the line an author meant to write usually gets deleted
    // instead of the SDK upgraded. Every other error passes through untouched.
    throw explainSubagentMemoryRefusal(error, installedSdkVersion())
  }
}
