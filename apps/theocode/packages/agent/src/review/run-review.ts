import { randomUUID } from 'node:crypto'

import { REVIEW_RUBRIC, buildReviewTarget, type GitRunner, type ReviewTarget } from './prompt.js'
import { formatReviewFindings, parseReviewOutput, type ReviewOutput } from './parse.js'

export interface ReviewRunResult {
  target: ReviewTarget
  output: ReviewOutput
  rendered: string
}

export interface ReviewAgentLike {
  send(message: string): Promise<{ wait(): Promise<{ result?: string }> }>
  dispose(): Promise<void>
}

export interface ReviewDeps {
  git: GitRunner
  createAgent: (opts: { agentId: string; systemPrompt: string }) => Promise<ReviewAgentLike>
}

export async function runReview(argsRaw: string, deps: ReviewDeps): Promise<ReviewRunResult> {
  const target = buildReviewTarget(argsRaw, deps.git)
  const agent = await deps.createAgent({
    agentId: `review-${randomUUID()}`,
    systemPrompt: REVIEW_RUBRIC,
  })
  try {
    const run = await agent.send(target.prompt)
    const result = await run.wait()
    const output = parseReviewOutput(result.result ?? '')
    return { target, output, rendered: formatReviewFindings(output) }
  } finally {
    await agent.dispose().catch((err: unknown) => {
      process.stderr.write(`[review] disposing the ephemeral reviewer failed: ${String(err)}\n`)
    })
  }
}
