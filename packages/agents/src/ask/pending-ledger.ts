/**
 * M77 — the client-side ledger of pending human decisions.
 *
 * ## Why a surface needs this at all
 *
 * The framework's own lookup is STATELESS. `ApprovalRegistry.list()` answers "what is pending right
 * now", and nothing remembers what a surface already showed or already answered. Two defects fall
 * straight out of that, and the consumer that prompted this milestone hit both:
 *
 * - **the dismissed card comes back** — the surface polls again, the same approval is still in the
 *   list, and it renders a second time;
 * - **a second answer is sent for an already-answered request** — the user clicks twice, or two
 *   surfaces answer, and the second send is a decision nobody made.
 *
 * Both are memory problems, and memory is the surface's to keep. Making the registry remember what
 * each surface has seen would put per-client state inside a process-wide primitive.
 *
 * ## What this deliberately is not
 *
 * No policy. It never decides whether to approve, never talks to the registry, never knows what an
 * approval means. It is bookkeeping over ids — which is why it is a pure function of its own state
 * and tested without a mock.
 */

/** A decision waiting for a human, as the surface knows it. */
export interface PendingItem<TPayload = undefined> {
  /** The framework's id for the decision (an approval id, a question id). */
  readonly id: string
  /**
   * Where in the conversation it belongs.
   *
   * Ordering key AND pruning key: a surface shows the oldest first, and a rewind invalidates
   * everything attached to messages that no longer exist.
   */
  readonly messageIndex: number
  /**
   * The SURFACE's own state for this item — render timestamps, collapsed flags, whatever it needs.
   *
   * T2.7. The framework never reads it; it is carried, not interpreted. Without this slot a surface
   * adopting the ledger has to keep a SECOND map keyed by the same id, which is strictly worse than
   * the single map it already maintains — and that is the measured reason `createPendingLedger`
   * shipped and went unused while a hand-written ledger stayed in the only real consumer.
   *
   * The default of `undefined` is what keeps this non-breaking: every existing caller writes
   * `PendingItem` with no argument and passes items with no payload.
   */
  readonly payload?: TPayload
}

export interface PendingLedger<TPayload = undefined> {
  /**
   * Record what the framework reports as pending.
   *
   * Additive and idempotent: the same list arrives on every poll. An id already settled is NOT
   * re-added — that single rule is what stops the dismissed card from coming back.
   */
  ingest(items: readonly PendingItem<TPayload>[]): void
  /**
   * Mark one as answered. `false` when it was unknown or already settled.
   *
   * The caller uses that boolean to decide whether to SEND: returning `true` twice would send a
   * decision the user made once, twice.
   */
  settle(id: string): boolean
  /** The oldest unsettled item, or `undefined`. A surface shows one at a time. */
  findNext(): PendingItem<TPayload> | undefined
  /**
   * Forget everything attached to a message before `messageIndex`, settled or not. Returns how many
   * unsettled items were dropped.
   *
   * The cutoff is the first index that STILL EXISTS, so an item sitting exactly on it survives.
   */
  pruneBefore(messageIndex: number): number
}

export function createPendingLedger<TPayload = undefined>(): PendingLedger<TPayload> {
  const open = new Map<string, PendingItem<TPayload>>()
  // Settled ids are remembered, not deleted: the framework's list is stateless and will report the
  // same id again on the next poll. Forgetting it here is what would resurrect the card.
  const settled = new Map<string, number>()

  return {
    ingest(items) {
      for (const item of items) {
        if (settled.has(item.id) || open.has(item.id)) continue
        open.set(item.id, item)
      }
    },

    settle(id) {
      const item = open.get(id)
      if (item === undefined) return false
      open.delete(id)
      settled.set(id, item.messageIndex)
      return true
    },

    findNext() {
      let oldest: PendingItem<TPayload> | undefined
      for (const item of open.values()) {
        // Conversation order, not insertion order: the list arrives however the registry enumerated
        // it, and "oldest first" has to mean the conversation's oldest to make sense to a human.
        if (oldest === undefined || item.messageIndex < oldest.messageIndex) oldest = item
      }
      return oldest
    },

    pruneBefore(messageIndex) {
      let dropped = 0
      for (const [id, item] of open) {
        if (item.messageIndex < messageIndex) {
          open.delete(id)
          dropped += 1
        }
      }
      // The settled set is pruned by the same cutoff, and this is the ONLY thing that bounds it:
      // without pruning it grows for the life of the session. The honest consequence is that a
      // pruned id is genuinely forgotten and a stale re-ingest could re-add it — which is why the
      // cutoff is driven by the conversation's own position and never by a timer.
      for (const [id, at] of settled) {
        if (at < messageIndex) settled.delete(id)
      }
      return dropped
    },
  }
}
