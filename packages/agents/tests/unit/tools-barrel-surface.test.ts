import { describe, expect, it } from 'vitest'

/**
 * M62 — `@theokit/agents/tools` re-exports the `@theokit/sdk-tools` factory surface as a pure
 * pass-through (parsimony Rung 9 — the sugar is the SDK-tools', not the layer's, so enriching would be
 * reinventing; blueprint Q5). This test LOCKS the symbols the agent-builder actually imports, so a
 * dropped re-export (or an sdk-tools version regression below what the consumer needs) fails loudly.
 */
import * as tools from '../../src/tools-entry.js'

const REQUIRED = [
  'createApplyPatchTool',
  'createCurrentTimeTool',
  'createEditFileTool',
  'createGenericHttpSearchAdapter',
  'createGitDiffTool',
  'createInteractiveShellTool',
  'createQuestionTool',
  'createReadFileTool',
  'createSearchTextTool',
  'createShellTool',
  'createUpdatePlanTool',
  'createWebFetchTool',
  'createWebSearchTool',
  'createWriteStdinTool',
  'withDescription',
  'withName',
] as const

describe('M62 — @theokit/agents/tools passes the sdk-tools factory surface through', () => {
  it('re-exports every tool factory + combinator the consumer uses', () => {
    for (const name of REQUIRED) {
      expect(tools[name as keyof typeof tools], name).toBeTypeOf('function')
    }
  })
})
