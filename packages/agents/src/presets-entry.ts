/**
 * `@theokit/agents/presets` — capability presets that assemble a whole kind of agent.
 *
 * A subpath rather than a member of the root barrel. `codingAgentPreset` and its gates came to about
 * 4 600 bytes of `dist/index.js`, which put the root bundle at 46 168 bytes against its 42 000-byte cap
 * (ADR 0033). It was never published from the root, and an agent that is not a coding agent does not pay
 * for it there.
 */
export {
  codingAgentPreset,
  codingAgentTools,
  type CodingAgentPresetOptions,
  type CodingAgentTools,
} from './capability/coding-agent-preset.js'
