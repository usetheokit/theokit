import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(__dirname, '../..')
const WORKFLOW = readFileSync(resolve(REPO, '.github/workflows/claude.yml'), 'utf8')

/**
 * The comment block that carries zizmor's `dangerous-triggers` suppression: the
 * `# zizmor: ignore[dangerous-triggers]` line and every comment line directly after it.
 */
function dangerousTriggersRationale(source: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.includes('zizmor: ignore[dangerous-triggers]'))
  if (start === -1) return ''
  const block: string[] = []
  for (let i = start; i < lines.length && lines[i].trim().startsWith('#'); i++) {
    block.push(lines[i].trim().replace(/^#\s?/, ''))
  }
  return block.join(' ').replace(/\s+/g, ' ')
}

describe('claude.yml dangerous-triggers suppression (B-634)', () => {
  // anthropics/claude-code-action, at the SHA claude.yml pins, fetches the pull request head
  // (refs/pull/N/head for a fork) and checks it out whenever it runs on an open pull request
  // (src/github/operations/branch.ts, setupBranch). A rationale that denies this misstates where
  // the trust boundary is for the next reviewer who reads it instead of the action.
  it('test_the_suppression_rationale_states_that_the_action_checks_out_the_pull_request_head', () => {
    const rationale = dangerousTriggersRationale(WORKFLOW)
    expect(rationale, 'claude.yml no longer suppresses dangerous-triggers').not.toBe('')
    expect(rationale).not.toMatch(/never\s+a\s+pull\s+request\s+head/i)
    expect(rationale).toMatch(/checks?\s+out\s+the\s+pull\s+request\s+head/i)
  })

  // The residual risk sits on issue_comment from a fork pull request; the control that bounds it
  // is the role gate. A rationale that names neither hides both from the reader.
  it('test_the_suppression_rationale_names_the_fork_checkout_and_the_role_gate', () => {
    const rationale = dangerousTriggersRationale(WORKFLOW)
    expect(rationale).toMatch(/\bfork\b/i)
    expect(rationale).toMatch(/author_association/)
    expect(rationale).toMatch(/issue_comment/)
  })

  // actions/checkout takes refs/pull/N/merge for the review events, so no claim of a default-branch
  // checkout holds for every trigger.
  it('test_the_suppression_rationale_does_not_claim_a_default_branch_checkout', () => {
    const rationale = dangerousTriggersRationale(WORKFLOW)
    expect(rationale).not.toMatch(/checks?\s+out\s+the\s+default\s+branch/i)
  })
})
