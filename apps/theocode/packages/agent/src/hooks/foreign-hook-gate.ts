import type { HookApprovalRequest } from '@theokit/agents'

/**
 * #130 — the answer this product gives when the framework asks whether to spawn a hook IT loaded.
 *
 * ## Which hooks reach this gate, and why the answer is always no
 *
 * This product's own hooks never do. They come from `settings.json`, are translated by
 * `buildHookHandlers`, and are handed to the framework with a `fingerprint` callback that resolves
 * each one against the on-disk approval store. That gate already exists and already works.
 *
 * What reaches HERE is the other path: the framework's compatibility loader reads
 * `<cwd>/.claude/settings.json` and `<cwd>/.theokit/hooks.json` itself, and spawns what it finds
 * without ever passing through `buildHookHandlers`. Measured before the gate existed: a hook
 * declared in a project `.claude/settings.json` fired once, with no approval prompt and no approval
 * file written, against a control arm at zero where the same tool still ran.
 *
 * So every request arriving here is by construction a hook this product did not translate, did not
 * fingerprint, and was never asked to approve. Refusing is not a policy choice made here — it is
 * the policy the README and `doctor` have stated all along, finally reaching the point of action.
 *
 * ## Why not approve them against the store instead
 *
 * Because the two identities cannot be made to agree, and pretending otherwise would be worse than
 * refusing. This product's fingerprint hashes `{command, event, matcher, timeoutMs}`;
 * {@link HookApprovalRequest} carries no timeout, and its `event` vocabulary is the framework's
 * (`preToolUse`) rather than the dialect's (`PreToolUse`). Matching on the subset that survives
 * would be a SECOND fingerprint answering the same security question — and two identities for one
 * gate is how gates drift apart until one of them approves what the other refuses.
 *
 * Running a foreign root's hooks under this product's approval is a real thing to want. It needs an
 * identity both sides can compute, which is a design question and not a predicate.
 *
 * ## A refusal is not a denial
 *
 * The framework treats a refused hook as one that was never configured: the operation the hook
 * attached to still proceeds. That is the contract this product asked for — the command should not
 * run; the work should not stop. A refused hook must never be more disruptive than an absent one.
 */
export function refuseForeignHook(_request: HookApprovalRequest): false {
  return false
}

/**
 * The files the framework loads hooks from directly, that exist and will therefore be refused.
 *
 * ## Why this is answered at resolution and not at the spawn
 *
 * `refuseForeignHook` above answers the framework's spawn-time question, and the framework treats a
 * refused hook as one that was never configured — the operation proceeds. So the refusal produces
 * no observable signal, and the earliest a spawn-time message could arrive is AFTER the hook has
 * already failed to fire.
 *
 * These files are on disk before the turn starts. "Will my hook run?" is answerable up front, with
 * the command named, which is the difference between a diagnostic and an autopsy.
 *
 * A `.claude/settings.json` hook is already covered by a different path — `normaliseHooks` pushes a
 * message into `droppedHooks`, which `settingsReport` collects and `doctor` renders — so it is not
 * repeated here. `.theokit/hooks.json` is not a settings candidate, `parseHooks` never sees it, and
 * it reached the operator through nothing at all.
 *
 * A file that cannot be parsed is reported WITHOUT commands rather than skipped. The framework will
 * still try to load it, so the refusal stands; naming a command that was never read would fabricate
 * the very evidence this message exists to supply.
 */
export function foreignHookRefusals(
  cwd: string,
  deps: { exists: (path: string) => boolean; read: (path: string) => string },
): readonly { path: string; commands: readonly string[] }[] {
  const path = `${cwd}/.theokit/hooks.json`
  if (!deps.exists(path)) return []

  let commands: string[]
  try {
    commands = commandsIn(JSON.parse(deps.read(path)))
  } catch {
    return [{ path, commands: [] }]
  }
  return commands.length === 0 ? [] : [{ path, commands }]
}

/** Every `command` under the nested `{ Event: [{ hooks: [{ command }] }] }` shape. */
function commandsIn(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return []
  const out: string[] = []
  for (const slots of Object.values(raw as Record<string, unknown>)) {
    if (!Array.isArray(slots)) continue
    for (const slot of slots) {
      const hooks = (slot as { hooks?: unknown }).hooks
      if (!Array.isArray(hooks)) continue
      for (const hook of hooks) {
        const command = (hook as { command?: unknown }).command
        if (typeof command === 'string' && command.length > 0) out.push(command)
      }
    }
  }
  return out
}

/**
 * What to tell the operator, naming the file and where hooks DO run.
 *
 * "A hook was refused" sends someone reading every settings file in the repository; naming the path
 * ends the search, and the second half says where hooks DO run so the message is an instruction
 * rather than a complaint.
 */
export function refusalNotice(refusal: { path: string; commands: readonly string[] }): string {
  const what =
    refusal.commands.length > 0
      ? refusal.commands.map((c) => `\`${c}\``).join(', ')
      : 'the hooks it declares'
  return (
    `${refusal.path} — ${what} will NOT run: the framework loads that file directly, so the ` +
    `command would spawn without this product's per-hook approval (#130). Move it to ` +
    `.theocode/settings.json to have it approved and run.`
  )
}
