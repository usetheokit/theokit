import type { SDKAgent } from '@theokit/sdk'
import { agentStep, fn, Workflow } from '@theokit/sdk/workflow'
import { z } from 'zod'

/** What the `digest` workflow takes: one text, never empty, at most 20000 characters. */
export const DigestInput = z.object({ text: z.string().min(1).max(20000) })

/** What it returns: between one and ten non-empty points. */
export const DigestOutput = z.object({ points: z.array(z.string().min(1)).min(1).max(10) })

export type DigestInputValue = z.infer<typeof DigestInput>
export type DigestOutputValue = z.infer<typeof DigestOutput>

const DASH = '- '

/**
 * The points of a draft: each line whose trimmed form starts with `- `, without that prefix. A
 * dash with no space after it is not a point, and an empty point is dropped.
 */
export function toPoints(draft: string): DigestOutputValue {
  const points = draft
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(DASH))
    .map((line) => line.slice(DASH.length).trim())
    .filter((point) => point !== '')
  return { points }
}

function draftPrompt(input: unknown): string {
  const { text } = DigestInput.parse(input)
  return [
    'List the key points of the text below, at most 10.',
    'Write each point on its own line starting with "- ", and write nothing else.',
    '',
    text,
  ].join('\n')
}

/**
 * The committed `digest` workflow (plan D1): a `draft` agent step on `agent`, whose final text is the
 * draft, then a `points` step that types it as `{ points }`. Both schemas are checked by the SDK: an
 * invalid input fails the run before the draft step, and a draft with no point or more than ten
 * fails it at the `points` step. A failure is `run.status === 'failed'`, never a throw.
 */
export function createDigestWorkflow(agent: SDKAgent): Workflow<DigestInputValue, DigestOutputValue> {
  return Workflow.create<DigestInputValue>({ name: 'digest', inputSchema: DigestInput, outputSchema: DigestOutput })
    .then<string>(agentStep('draft', agent, draftPrompt))
    .then<DigestOutputValue>(fn<string, DigestOutputValue>('points', toPoints, { outputSchema: DigestOutput }))
    .commit()
}
