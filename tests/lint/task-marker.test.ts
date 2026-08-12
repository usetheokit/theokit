import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * agent-builder#120 — the forgotten task marker gets a signal again, without the word `todo`.
 *
 * ## Why the lint rule went away, and why this took its place
 *
 * `sonarjs/todo-tag` matches **TODO in any case**, and `todo` is a common Portuguese word (it means
 * "every"). It broke the layer's build **three times in M95**, always on legitimate prose — *"por
 * where every turn passes"*, *"for every error"*. The measurement that closed the decision: **real**
 * markers in the layer's source → **0**. Zero true positives against three false ones is a permanent
 * cost with no benefit, so the rule was disabled (`eslint.config.js`).
 *
 * What was left as residue, and is the reason for this file: with it disabled, a **genuine** `// TODO:`
 * stopped being flagged, and the substitute control became **convention** — debt in an ADR's
 * `## Corrections` and residue declared in the code. Convention is not enforcement; a control that
 * depends on somebody remembering fails by **omission**.
 *
 * ## What this gate matches, and why that shape
 *
 * Only the shape a real marker has: **uppercase + colon**, and **inside a comment**.
 *
 * | Text | Matches? | Why |
 * |---|---|---|
 * | `// TODO: replace this` | yes | it is a marker |
 * | `// por onde todo turno passa` | no | lowercase, no colon — M95's 3 false positives |
 * | `` `return { message: 'TODO: implement ${name}' }` `` | não | não é comentário: é a **saída** do
 *   the `theo generate` scaffold generator, a marker for the user, not debt of ours |
 *
 * The third row is why the comment is required instead of scanning raw text: the only two occurrences
 * of `TODO:` in the repository today are exactly that one, and a gate that flagged them would be born
 * red from noise — and a gate born red is switched off the following week.
 *
 * ## The anti-vacuity floor
 *
 * A scan that returns zero passes green, and is indistinguishable from one that does not know how to
 * look. Two negative tests below kill that ambiguity: the detector **finds** a synthetic marker, and
 * the scan **sees** the same number of files the git index reports.
 */

/** Uppercase + colon, inside a `//` or `/* ... ` comment. */
const MARKER = /(?:\/\/|\/\*|^\s*\*)[^\n]*\b(TODO|FIXME|XXX|HACK):/

const EXTENSIONS = ['*.ts', '*.tsx', '*.mts', '*.cts']

/** The layer's production and test roots — derived from the git index, never transcribed. */
function trackedFiles(): string[] {
  // `git` from PATH is the point: this gate asks the index of the repository it is running in. An
  // absolute path would break outside Linux and closes no threat at all in a test that already runs
  // with the privileges of whoever invoked it.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
  const output = execFileSync('git', ['ls-files', ...EXTENSIONS], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
  return (
    output
      .trim()
      .split('\n')
      .filter((f) => f.length > 0)
      .filter(
        (f) => f.startsWith('packages/') || f.startsWith('tests/') || f.startsWith('scripts/'),
      )
      .filter((f) => !f.includes('/templates/') && !f.includes('/dist/'))
      // This very file writes the markers into the prose that explains them.
      .filter((f) => !f.endsWith('tests/lint/task-marker.test.ts'))
      // And so does its sibling: `no-ptbr.test.ts` exempts THIS file in its own list, and explains
      // why in a comment that necessarily spells the marker out (*"an English `TODO:` marker"*). The
      // exemption is reciprocal because the reason is: a gate whose prose explains what it looks for
      // cannot be the thing it looks for. Backlog B-M67-01, item 14.
      .filter((f) => !f.endsWith('tests/lint/no-ptbr.test.ts'))
  )
}

interface Finding {
  readonly file: string
  readonly lineText: number
  readonly text: string
}

function markers(fileList: readonly string[]): Finding[] {
  const findings: Finding[] = []
  for (const file of fileList) {
    let contents: string
    try {
      contents = readFileSync(file, 'utf8')
    } catch {
      // A file in the index that vanished from disk is not a marker — it is a rename in flight.
      continue
    }
    if (!contents.includes('TODO:') && !/(FIXME|XXX|HACK):/.test(contents)) continue
    const lines = contents.split('\n')
    for (const [i, lineText] of lines.entries()) {
      if (MARKER.test(lineText)) findings.push({ file, lineText: i + 1, text: lineText.trim() })
    }
  }
  return findings
}

describe('agent-builder#120 — a task marker in a comment', () => {
  it('test_no_forgotten_task_marker_in_the_layers_source', () => {
    const fileList = trackedFiles()
    expect(
      markers(fileList),
      "debt marked in a comment is tracked by nobody — record it in an ADR's `## Corrections` or as declared residue, and remove the marker",
    ).toEqual([])
  })

  it('test_FLOOR_the_sweep_sees_the_same_as_the_git_index', () => {
    // Without this, a broken filter would return zero files and the test above would pass empty.
    const fileList = trackedFiles()
    expect(fileList.length).toBeGreaterThan(500)
    expect(fileList.some((f) => f.startsWith('packages/agents/src/'))).toBe(true)
    expect(fileList.some((f) => f.startsWith('tests/'))).toBe(true)
  })

  it('test_NEGATIVE_the_detector_finds_a_synthetic_marker', () => {
    const markerText = ['// ' + 'TODO' + ': replace this before the release'].join('\n')
    expect(MARKER.test(markerText)).toBe(true)
    expect(MARKER.test(' * ' + 'FIXME' + ': idem')).toBe(true)
  })

  it('test_NEGATIVE_the_pt_BR_prose_that_broke_M95_three_times_does_NOT_match', () => {
    for (const prosa of [
      '// o adaptador por onde todo turno passa',
      '// para todo erro do provedor, um código nosso',
      ' * todo estado novo entra por aqui',
    ]) {
      expect(MARKER.test(prosa), prosa).toBe(false)
    }
  })

  it('test_NEGATIVE_a_marker_inside_a_scaffold_string_does_NOT_match', () => {
    // The output of `theo generate` — a marker for the user, not debt of this repository.
    expect(MARKER.test("    `    return { message: 'TODO: implement ${name}' }`,")).toBe(false)
  })
})
