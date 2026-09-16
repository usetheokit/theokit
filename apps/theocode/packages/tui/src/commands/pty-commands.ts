/**
 * `/ps` and `/stop` — the inventory and the kill switch for background shells.
 *
 * Extracted from the `shells` group, which was the last one in `interpret-command.ts` still holding
 * its own logic inline: every other group delegates to a handler module, and the file had grown past
 * the 400-line budget the lint enforces. Moving the bodies out is the same answer this codebase
 * already gives a group that outgrows its budget.
 *
 * Both messages distinguish "there were none" from "there were some", and that is the whole point of
 * them. `/stop` on an empty set and `/stop` that killed four sessions are different events, and a
 * single "done" would leave a user who expected a runaway process to die unable to tell which one
 * they got.
 */
import type { PtysTheInterpreterUses } from './command-capabilities.js'
import type { ToastPayload } from '../screen-types.js'

export function handleListPtys(
  ptyOwner: PtysTheInterpreterUses,
  setToast: (toast: ToastPayload) => void,
): void {
  const n = ptyOwner.backend().activeSessionCount()
  setToast({
    message:
      n === 0
        ? 'No background shell sessions'
        : `${String(n)} background shell session(s) — /stop ends all of them`,
    variant: 'info',
  })
}

export function handleStopPtys(
  ptyOwner: PtysTheInterpreterUses,
  setToast: (toast: ToastPayload) => void,
): void {
  const before = ptyOwner.backend().activeSessionCount()
  ptyOwner.backend().killAll()
  setToast({
    message:
      before === 0
        ? 'Nothing to stop — no background sessions'
        : `${String(before)} background shell session(s) ended`,
    variant: before === 0 ? 'info' : 'success',
  })
}
