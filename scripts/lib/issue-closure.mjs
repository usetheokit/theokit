/**
 * Whether a shipped pull request may close the issue it names (#2609).
 *
 * The factory closed #1841, #1840 and #1832 when the first partial pull request shipped, with
 * most of their "Done when" boxes unchecked and no issue left to track the rest. This is the pure
 * decision, importable without side effects, so the release step that posts "Available in ..."
 * asks it before closing.
 *
 * Fail closed: an issue body that cannot be read never closes the issue.
 */

/** `Follow-up: #123` (also `Follow up`, `Followup`) on its own line in the pull request body. */
const FOLLOW_UP = /^[ \t]*follow[- ]?up(?: issue)?[ \t]*:[ \t]*(?:[\w.-]+\/[\w.-]+)?#(\d+)\b/gim

/**
 * Unchecked `- [ ]` boxes under the issue's "Done when" heading, up to the next heading or rule.
 * An issue with no such section has none, so it keeps its old behavior.
 *
 * @param {string} issueBody
 * @returns {string[]}
 */
export function uncheckedDoneWhen(issueBody) {
  const lines = issueBody.split('\n')
  const start = lines.findIndex((line) => /^#{0,6} ?\**done when\**:?$/i.test(line.trim()))
  if (start === -1) return []
  const open = []
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#{1,6}\s/.test(line) || /^\s*---+\s*$/.test(line)) break
    const text = line.trim()
    if (/^[-*] \[ \] /.test(text)) open.push(text.slice(6).trim())
  }
  return open
}

/**
 * The follow-up issue number the pull request names, or undefined.
 *
 * @param {string|undefined} prBody
 * @param {number} [issueNumber] the issue being closed; it is never its own follow-up
 * @returns {number|undefined}
 */
export function namedFollowUp(prBody, issueNumber) {
  if (typeof prBody !== 'string') return undefined
  for (const match of prBody.matchAll(FOLLOW_UP)) {
    const number = Number(match[1])
    if (number !== issueNumber) return number
  }
  return undefined
}

/**
 * @param {{ issueNumber: number, issueBody: string|undefined, prBody: string|undefined }} input
 * @returns {{ action: 'close'|'keep-open', reason: string, followUp?: number, unchecked: string[], closingNote?: string }}
 */
export function decideClosure({ issueNumber, issueBody, prBody }) {
  if (typeof issueBody !== 'string') {
    return { action: 'keep-open', reason: 'issue body unreadable', unchecked: [] }
  }
  const unchecked = uncheckedDoneWhen(issueBody)
  if (unchecked.length === 0) return { action: 'close', reason: 'all done', unchecked }
  const followUp = namedFollowUp(prBody, issueNumber)
  if (followUp === undefined) {
    return {
      action: 'keep-open',
      reason: 'unchecked Done when boxes, no follow-up named',
      unchecked,
    }
  }
  return {
    action: 'close',
    reason: 'unchecked boxes moved to a follow-up',
    followUp,
    unchecked,
    closingNote: `Partly delivered: ${unchecked.length} "Done when" box(es) remain, tracked in #${followUp}.`,
  }
}
