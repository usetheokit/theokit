/** Types for `check-app-issue-reasons.mjs`, so the root test imports it without a suppression. */

export interface IssueReason {
  file: string
  line: number
  repo: string
  issue: number
}

export const DEFAULT_REPO: string
export function findReasons(text: string, file?: string): IssueReason[]
export function collectReasons(root: string): IssueReason[]
export function githubState(
  repo: string,
  issue: number,
  fetchImpl?: typeof fetch,
  token?: string,
): Promise<'open' | 'closed'>
export function checkReasons(
  reasons: IssueReason[],
  lookup?: (repo: string, issue: number) => Promise<'open' | 'closed'>,
): Promise<string[]>
