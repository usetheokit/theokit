/**
 * A stand-in for `@theokit/agents` inside a temp project, used by the generated-schedule tests.
 *
 * It re-exports the real built package and wraps `streamAgentTurnInProcess` so each run is
 * recorded on `globalThis.__scheduleProbe` and the model stream is the test's script. The real
 * function still runs, so its approval-gate check and the `auto-reject` resolver are under test.
 */
import { streamAgentTurnInProcess as realStreamAgentTurnInProcess } from '../../../packages/agents/dist/index.js'

export * from '../../../packages/agents/dist/index.js'

export function streamAgentTurnInProcess(mod, apiKey, input) {
  const probe = globalThis.__scheduleProbe
  probe.runs.push({ apiKey, input })
  return realStreamAgentTurnInProcess(mod, apiKey, input, { stream: probe.stream })
}
