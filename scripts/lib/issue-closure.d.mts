/** Types for `issue-closure.mjs`. */
export function uncheckedDoneWhen(issueBody: string): string[]
export function namedFollowUp(prBody: string | undefined, issueNumber?: number): number | undefined
export function decideClosure(input: {
  issueNumber: number
  issueBody: string | undefined
  prBody: string | undefined
}): {
  action: 'close' | 'keep-open'
  reason: string
  followUp?: number
  unchecked: string[]
  closingNote?: string
}
