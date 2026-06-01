/**
 * core/contracts/ — canonical home for shared client↔server contracts.
 *
 * Per ADR-0001 v3 invariant #3: this directory is the EXCEPTION to the
 * `no-cross-module-deep-import` rule. Any module may import directly from
 * `core/contracts/<file>.js`.
 *
 * This barrel exists for convenience. Consumers may use it OR import the
 * specific file (`core/contracts/agent-events.js`) — both are legal.
 */

export type {
  AgentRunErrorCode,
  AgentMessageEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentErrorEvent,
  AgentEvent,
} from './agent-events.js'
export type { RouteConfig } from './route-config.js'
export type { RouteNode } from './route-node.js'

// Action protocol (G3 / T0.1). Types separated from runtime so type-only
// consumers tree-shake the classes out.
export type {
  ActionErrorCode,
  ActionManifestEntry,
  ActionResult,
  SerializedActionResult,
  UniversalZodIssue,
} from './action-protocol.js'
export {
  ActionError,
  ActionInputError,
  extractUniversalIssues,
  isActionError,
  isInputError,
} from './action-protocol.js'
