import type { CustomTool, SDKAgent } from '@theokit/sdk'
import { workflowAsTool, workflowResumeTool, type WorkflowRun } from '@theokit/sdk/workflow'

import { createTriageWorkflow, TriageInput, type GenerateObject, type TriageInputValue } from './triage-workflow.js'
import { createDigestWorkflow, DigestInput, type DigestInputValue, type DigestOutputValue } from './digest-workflow.js'

/** Runs `work` inside one request boundary over a fresh draft agent, disposed when `work` settles. */
export type WithDraftAgent = <R>(work: (agent: SDKAgent) => Promise<R>) => Promise<R>

export interface WorkflowToolOptions {
  /**
   * The draft agents' request boundary, built by the composition root over a factory with no tool
   * options (plan D3). Absent: no workflow tool is registered.
   */
  readonly withDraftAgent?: WithDraftAgent
  /**
   * The JSON-only model call of the `triage` workflow (B-678), shell withheld and memory off. Absent:
   * no `triage` tool and no `triage_resume` tool.
   */
  readonly generateObject?: GenerateObject
  readonly write: (line: string) => void
}

const DIGEST_STEPS = 2

const DIGEST_DESCRIPTION =
  'Digest a text into at most 10 key points. Runs the typed two-step digest workflow: a draft step ' +
  'on a separate agent with no tools, then a step that checks the points. Returns { points }.'

function runLine(run: WorkflowRun): string {
  const completed = run.stepResults.filter((step) => step.status === 'completed').length
  return `theoclaw-workflow: digest ${run.id} ${run.status} ${completed}/${DIGEST_STEPS} steps`
}

/** The error's name only: its message can carry a configured value, so it never reaches the log. */
function notStartedLine(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error'
  return `theoclaw-workflow: digest - not-started 0/${DIGEST_STEPS} steps ${name}`
}

/**
 * One `digest` run per tool call, on its own draft agent, with one log line: the run's id, status
 * and completed steps, or `not-started` when the boundary failed before a run existed. A run that
 * exists is logged even when disposing its agent fails afterwards, and the text is never logged.
 */
function digestRunner(withDraftAgent: WithDraftAgent, write: (line: string) => void) {
  return async (input: DigestInputValue): Promise<WorkflowRun<DigestOutputValue>> => {
    let run: WorkflowRun<DigestOutputValue> | undefined
    try {
      return await withDraftAgent(async (agent) => {
        run = await createDigestWorkflow(agent).run(input)
        return run
      })
    } catch (error) {
      if (run === undefined) write(notStartedLine(error))
      throw error
    } finally {
      if (run !== undefined) write(runLine(run))
    }
  }
}

const TRIAGE_DESCRIPTION =
  'Triage a text: a JSON-only step classifies it as { category, summary }, then the run suspends for ' +
  'approval and returns { status: "suspended", runId, stepId }. Give that runId to triage_resume only ' +
  'once the person has approved or refused; never invent one.'

const TRIAGE_RESUME_DESCRIPTION =
  'Resume a suspended triage run by its runId, with { approved: true | false } as the payload. ' +
  'Returns { category, summary, approved }. A run id resumes once.'

/** The `triage` tool and its resume tool over one committed workflow, so a run id resumes on the instance that suspended it. */
function triageTools(generate: GenerateObject, write: (line: string) => void): CustomTool[] {
  const workflow = createTriageWorkflow(generate)
  // One log line per started run: the id and status only, never the text or the payload.
  const logged = {
    run: async (input: TriageInputValue): Promise<WorkflowRun> => {
      const run = await workflow.run(input)
      write(`theoclaw-workflow: triage ${run.id} ${run.status}`)
      return run
    },
  }
  return [
    workflowAsTool(logged, { name: 'triage', description: TRIAGE_DESCRIPTION, inputSchema: TriageInput, reportSuspended: true }),
    workflowResumeTool(workflow as unknown as Parameters<typeof workflowResumeTool>[0], { name: 'triage_resume', description: TRIAGE_RESUME_DESCRIPTION }),
  ]
}

/**
 * The workflow tools of a `/control` agent: `digest`, through the SDK's `workflowAsTool` (plan D1),
 * which validates the model's arguments, runs the workflow and turns a run that did not complete into
 * a `WorkflowToolError`, so the model gets a tool error; and with a JSON-only model call, `triage` and
 * `triage_resume` (B-679). Each is absent without its seam.
 */
export function createWorkflowTools(options: WorkflowToolOptions): CustomTool[] {
  const tools: CustomTool[] = []
  if (options.withDraftAgent !== undefined) {
    tools.push(
      workflowAsTool(
        { run: digestRunner(options.withDraftAgent, options.write) },
        { name: 'digest', description: DIGEST_DESCRIPTION, inputSchema: DigestInput },
      ),
    )
  }
  if (options.generateObject !== undefined) tools.push(...triageTools(options.generateObject, options.write))
  return tools
}
