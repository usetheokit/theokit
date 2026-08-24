/**
 * M84 — `@theokit/agents/client/react`: the hook, separated from the rest of the chain.
 *
 * The separation is not cosmetic. `@theokit/agents/client` is **React-free by contract** so that a
 * Node consumer — an in-process transport in a process with no UI — does not drag React into its
 * graph merely by importing a transport. Putting the two in a single entry did exactly that, and the
 * gate inherited from the CLI (`test_client_core_entry_imports_no_react`) failed on the first run.
 *
 * `react` is an **optional** peer of the package: anyone who never imports this entry does not need
 * it installed; anyone who does already has it, because a hook only runs inside a component.
 */
export { useAgent } from './client/use-agent.js'
export type {
  PendingApproval,
  UseAgentReturn,
  UseAgentOptions,
  UseAgentStatus,
} from './client/use-agent.js'
