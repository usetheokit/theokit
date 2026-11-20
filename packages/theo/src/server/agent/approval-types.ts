/**
 * The types the approval registry and its durable store share (usetheokit/theokit#1960). They live
 * apart from both so that neither module imports the other: the registry names the store it may
 * hold, and the store implements the registry.
 */
// The timeout policy vocabulary is owned by the `@HumanInTheLoop` decorator (DRY / G12) — reuse it
// rather than re-declaring the union, so the two can never drift.
import type { TimeoutAction } from '@theokit/agents'

export interface RegisterOptions {
  /** Milliseconds before the approval auto-settles per `onTimeout`. */
  timeoutMs: number
  /**
   * What a timeout means. Only `'proceed'` auto-approves; `'abort'` and `'retry'` both deny — the
   * registry does NOT implement retry semantics (a timed-out `'retry'` is a deny, not a re-prompt).
   */
  onTimeout: TimeoutAction
  /** M14 — the gated tool name, surfaced by `list()` (optional; absent for legacy callers). */
  toolName?: string
  /** M14 — the approval question, surfaced by `list()` (optional). */
  question?: string
  /**
   * Who the run belongs to — the `RouteSubject.id` admitted for it (B-016).
   *
   * Absent when the run had no identity to record, which is the `'public'` agent path:
   * `admitAgentRequest` deliberately does not resolve a subject when the policy is absent or
   * `'public'`, so there is nothing to attribute the approval to. Absent therefore means "no owner
   * was established", never "anyone", and the caller must branch on the difference — a rule that
   * refused when it is absent would start turning public agents away.
   *
   * Deliberately NOT surfaced by `list()`: that listing feeds a UI, and owner ids are identity.
   */
  owner?: string
  /**
   * M20 — an optional JSON-schema descriptor of the custom payload the approver may attach. Carried
   * verbatim into `list()` + the `approval_required` event so the UI knows what to collect. Kept as
   * a plain JSON object (not a live Zod schema) so the registry stays serializable and SDK-free.
   */
  payloadSchema?: Record<string, unknown>
}

/**
 * M20 — a settled HITL decision. `approved` is the allow/deny bit (backward-compatible with the
 * legacy boolean); `reason` + `payload` are the optional approver-attached extras that surface to
 * the model (on denial, via the veto message) and to the app/UI.
 */
export interface ApprovalDecision {
  approved: boolean
  reason?: string
  payload?: unknown
  /**
   * What settled this, when it was not a person (usetheokit/theokit#393).
   *
   * Absent means the decision arrived through `resolve()` — a human, or whatever the application
   * wired to that route. `'timeout'` means the window closed with nobody deciding and `onTimeout`
   * was applied.
   *
   * The distinction is the whole point of a HITL gate: without it an expired approval and an
   * explicit deny are byte-identical on the wire, and the sentence the caller gets — "denied by
   * human approver" — asserts a fact that did not happen. It is marked on the ALLOW side too:
   * `onTimeout: 'proceed'` permits the tool BECAUSE nobody answered, and recording that as a plain
   * approval is the same fabrication with the opposite sign.
   *
   * One member rather than `timedOut: boolean`, because the question is what settled it; a second
   * cause (a cancel, a shutdown) joins the union instead of adding another boolean.
   */
  settledBy?: 'timeout'
}

/** M14 — a pending approval as surfaced by {@link ApprovalRegistry.list}. */
export interface PendingApproval {
  approvalId: string
  toolName?: string
  question?: string
  /** Epoch millis when the pending approval auto-settles (registeredAt + timeoutMs). */
  expiresAt: number
  /** M20 — the declared custom-payload schema, if the gated tool declares one. */
  payloadSchema?: Record<string, unknown>
}

export interface ApprovalRegistry {
  /**
   * Register a pending approval; the returned Promise settles with the full {@link ApprovalDecision}
   * on `resolve` or timeout (M20 — was a bare boolean pre-M20).
   */
  register(approvalId: string, opts: RegisterOptions): Promise<ApprovalDecision>
  /**
   * Settle a pending approval. Accepts a full {@link ApprovalDecision} OR a bare boolean (coerced to
   * `{ approved }` — backward-compatible). Returns false if the id is unknown or already settled.
   */
  resolve(approvalId: string, decision: boolean | ApprovalDecision): boolean
  /** M14 — list the currently-pending approvals (process-wide; single-process contract). */
  list(): PendingApproval[]
  /**
   * Who owns the pending approval `approvalId`, or `undefined` (B-016).
   *
   * `undefined` covers three cases the caller treats identically — never registered, already
   * settled, and registered without an owner — because in all three there is nothing to compare a
   * caller against.
   */
  ownerOf(approvalId: string): string | undefined
  /**
   * How far this registry's answers reach — B-236.
   *
   * `'instance'` means every answer is about ONE process. `getApprovalRegistry()` resolves a
   * `processSingleton`, and every deploy target the approvals listing became reachable on is
   * multi-instance by construction: a Worker is isolates, a Lambda is concurrent invocations. So
   * an owner whose run paused on another instance was answered `200 {approvals: []}`, which is
   * indistinguishable from "nothing is pending".
   *
   * It is declared HERE rather than assumed by the listing handler because the interface is
   * injectable so a durable implementation can replace this one. A constant in the handler would
   * become false the day somebody wires that up, which is this defect one layer higher.
   *
   * Optional, and an implementation that declares nothing is read as `'instance'`. Silence takes
   * the narrow claim: a registry that cannot say how far it reaches must not be reported as
   * speaking for a deployment.
   */
  readonly scope?: ApprovalRegistryScope
  /**
   * Present on a durable registry: the store holding the pending records. The listing and approve
   * routes read it asynchronously instead of going through the synchronous methods above, which a
   * durable registry cannot answer (it never holds a live Promise).
   */
  readonly store?: ApprovalStore
}

/**
 * How far a registry's answers reach.
 *
 * `'shared'` is declared by an implementation backed by a store every instance reads — nothing in
 * this framework ships one today (YAGNI), and the value exists so that wiring one does not mean
 * editing the listing handler.
 */
export type ApprovalRegistryScope = 'instance' | 'shared'

/** One pending approval, as persisted. `schemaVersion` lets a later release change the shape. */
export interface StoredApproval {
  readonly schemaVersion: 1
  readonly approvalId: string
  readonly agentName: string
  readonly sessionId: string
  readonly toolUseId: string
  readonly toolName: string
  readonly question?: string
  readonly owner?: string
  /** Epoch ms after which `onTimeout` applies. */
  readonly expiresAt: number
  readonly onTimeout: TimeoutAction
  readonly payloadSchema?: Record<string, unknown>
}

/**
 * Where pending approvals live. Implement it over Redis or a database for a deploy whose instances
 * share no filesystem.
 *
 * `claim` is optional: it removes the record and returns it ONLY to the one caller that got there
 * first, which is what stops two instances resuming the same approval. A store without it falls
 * back to `get` + `delete`, which is not atomic.
 */
export interface ApprovalStore {
  put(record: StoredApproval): Promise<void>
  get(approvalId: string): Promise<StoredApproval | undefined>
  delete(approvalId: string): Promise<void>
  list(): Promise<readonly StoredApproval[]>
  claim?(approvalId: string): Promise<StoredApproval | undefined>
}
