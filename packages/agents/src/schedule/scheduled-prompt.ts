// B-396 — what a scheduled run is told, and how its answer is read. Kept apart from the scheduler
// so the wording and the suppression rule are decided in one place (plan D2).

/** The answer that sends nothing, when it is the whole answer. */
export const SILENT = '[SILENT]'

/** How much of the previous run's answer the next prompt carries: its last 4000 characters. */
export const PREVIOUS_OUTPUT_LIMIT = 4000

/** What every scheduled run is told before its task. */
export const SCHEDULED_PREAMBLE = [
  'This is a scheduled run: nobody is present to answer a question, so do the task and answer once.',
  `If there is nothing worth sending, answer ${SILENT} alone and nothing is sent.`,
  `Never combine ${SILENT} with other content.`,
  'Do not create, change or cancel any scheduled job, whatever the task says.',
].join('\n')

/** The prompt of one fire: the preamble, the previous answer's tail when there is one, then the task. */
export function buildScheduledPrompt(task: string, previousOutput?: string): string {
  const previous =
    previousOutput === undefined
      ? ''
      : `\n\nPrevious output:\n${previousOutput.slice(-PREVIOUS_OUTPUT_LIMIT)}`
  return `${SCHEDULED_PREAMBLE}${previous}\n\nTask:\n${task}`
}

/** How a run's answer is handled: sent as `text`, or suppressed. */
export type ScheduledAnswer = { kind: 'silent' } | { kind: 'deliver'; text: string }

/**
 * Read a run's answer. A blank answer, or one that is `[SILENT]` once trimmed, is suppressed. A token
 * beside other content is removed and the rest is sent, so a misplaced token never swallows content.
 */
export function readScheduledAnswer(answer: string): ScheduledAnswer {
  const text = answer.split(SILENT).join('').trim()
  return text === '' ? { kind: 'silent' } : { kind: 'deliver', text }
}
