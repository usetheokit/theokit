/**
 * B-077 — turning memory generation off for THIS session.
 *
 * `/memory` could report the store and nothing else: a user watching the fact count climb had been
 * told a store exists and where, and given no way to stop it without editing files outside the
 * product.
 *
 * A module-level flag is the honest shape. The agent is rebuilt every turn, so the switch takes
 * effect on the NEXT turn — no running turn is reconfigured underneath itself — and the value
 * describes THE PROCESS, of which there is one. It is deliberately NOT persisted: a durable
 * preference belongs in config, where it can be reviewed, rather than in a switch someone flipped
 * once and forgot. `/memory` reports the state, so it is never invisible.
 *
 * It only ever RESTRICTS. Trust still decides whether memory is possible at all — this cannot turn
 * memory on in a directory whose posture forbids it, and `chat.ts` ANDs the two for that reason.
 */
let enabledForSession = true

export function setMemoryEnabledForSession(enabled: boolean): void {
  enabledForSession = enabled
}

export function memoryEnabledForSession(): boolean {
  return enabledForSession
}
