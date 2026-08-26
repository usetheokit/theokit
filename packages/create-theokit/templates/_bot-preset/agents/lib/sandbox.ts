import { createSandboxBackend, type SandboxProvider } from '@theokit/agents/sandbox'

/**
 * The confinement every bot in this scaffold runs under.
 *
 * `workspace-write` is the honest default for a bot: it writes, and only inside the roots the
 * sandbox names. The two alternatives are wrong here in opposite directions — `read-only` makes a
 * bot that cannot do its job, and `danger-full-access` hands an unattended agent the whole machine.
 *
 * Built through the SDK's own factory rather than by hand. The first draft of this file returned
 * `{ mode: 'workspace-write' }` cast to the type, which `tsc` refused on the scaffolded app — and it
 * was right to: a `SandboxProvider` is a BACKEND (or a function returning one), not a config object.
 * The factory is documented as an "honest factory": it uses kernel enforcement where bwrap exists,
 * and where it does not it warns once and falls back rather than pretending to sandbox.
 *
 * It is a function rather than a constant so a real deployment can swap the backend — a container, a
 * remote sandbox — without every tool learning a new shape.
 */
export function workspaceSandbox(): SandboxProvider {
  return createSandboxBackend({ mode: 'workspace-write' })
}
