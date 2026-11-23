/**
 * B-057 — the one place the terminal UI learns which directory it is working in.
 *
 * There were 23 reads of `process.cwd()` across 13 files. They agreed, because the TUI parses no
 * directory flag — which is why the review filed this MEDIUM and its `ConsentGates` instance LOW.
 * They agree by coincidence, not by construction: the day a `--cd` arrives, trust resolves for one
 * directory and configuration for another, and nothing says so.
 *
 * A module-level constant would NOT do. It is evaluated at import time, and ESM hoists every import
 * before the first statement — the exact defect B-026 fixed in the CLI's bootstrap. So this is a
 * slot, set once before the surface is built and read everywhere after.
 *
 * Setting it twice THROWS rather than winning silently. That is the B-035 lesson: a single slot that
 * quietly accepts a second write is how a surface stops being notified with no error and no warning.
 *
 * WHY THERE IS NO `/cd`, measured rather than assumed. Codex has one, and the reason this build
 * answers the name with a pointer (`codex-names.ts`) is not that the slot refuses a second write —
 * that refusal is one line to relax. It is that only the AGENT would follow the move. Every turn
 * rebuilds it from this seam (`chat-transport.ts` passes `workingDirectory()` to both
 * `resolveEffectiveConfig` and `buildChatAgent`, and `chat.ts` resolves the trust posture inside
 * that build), so the model would arrive in the new directory while the surface around it stayed in
 * the old one:
 *
 *   - `composition-root.ts` reads the directory ONCE in `build()`, and `getTuiRoot()` memoises the
 *     result. The session pointer, the goal pointer, the PTY owner's sandbox mode and the custom
 *     commands — loaded with `projectTrusted` from the FIRST directory's posture — are all fixed by
 *     that call. A `/cd` out of a trusted repository would leave its slash commands loaded, and
 *     runnable, at its trust level.
 *   - `tui-session.ts` closes over the directory, so even `reloadConfig()` re-reads the original
 *     one. `/status`, the footer and the effort default would describe a directory the agent left.
 *   - `use-consent.ts` seeds `trusted` into React state once. Moving into an untrusted directory
 *     would not raise the trust gate, and approving a gate raised for the old directory persists
 *     trust for whatever `workingDirectory()` says at the moment of the click
 *     (`ConsentGates.tsx`) — the wrong directory, durably.
 *   - `credential-helpers.ts` and `main.tsx` bake `.env` and the stderr log path at import.
 *
 * Making it safe therefore means rebuilding the composition root — which discards the live session,
 * transport and background shells — or threading a getter through each of the sites above AND
 * re-seeding the consent state, while `@theocode/agent` still defaults several entry points to
 * `process.cwd()` rather than to a passed directory (`session/session-ops.ts`, `session/gc`,
 * `hooks/hook-trust.ts`, `config/config.ts`). Until that is done, a `/cd` would move the path and
 * leave the posture behind, which is a security defect and not a rough edge. Relaunching in the
 * other directory is slower and correct.
 */
let selected: string | undefined

export class WorkingDirectoryAlreadySetError extends Error {
  override readonly name = 'WorkingDirectoryAlreadySetError'
  readonly code = 'working_directory_already_set' as const

  constructor(current: string, attempted: string) {
    super(
      `the working directory is already set to ${current} and cannot be changed to ${attempted}: ` +
        'trust, configuration and the session pointer are all resolved from it, and moving it ' +
        'mid-run would leave them describing different directories.',
    )
  }
}

/** Called ONCE, before the surface is composed. */
export function setWorkingDirectory(dir: string): void {
  if (selected !== undefined && selected !== dir) {
    throw new WorkingDirectoryAlreadySetError(selected, dir)
  }
  selected = dir
}

/** The directory this run works in. Falls back to the process one until something sets it. */
export function workingDirectory(): string {
  return selected ?? process.cwd()
}

/** Test-only: forget the selection so each test starts from the same state. */
export function resetWorkingDirectoryForTest(): void {
  selected = undefined
}
