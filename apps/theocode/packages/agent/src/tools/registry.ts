import { ConfigurationError, Toolset } from '@theokit/agents'
import type { CustomTool } from '@theokit/agents'
import { codingAgentTools } from '@theokit/agents/presets'
import type { SandboxBackend } from '@theokit/agents/sandbox'

export interface ToolScope {
  cwd: string
  writeRoot: string
  /**
   * B-006 — required. It used to be optional, and its absence was handled by omitting the `sandbox`
   * option from `createShellTool` — so a scope built without one produced an UNCONFINED shell with
   * no error and no warning. Every construction path already goes through `resolveToolScope`, which
   * always supplies a backend, so requiring it makes the unconfined scope unrepresentable rather
   * than merely detectable.
   */
  sandbox: SandboxBackend
  defaultTimeoutMs?: number
}

/**
 * The tools this product registers, by the name the model and the configuration both use.
 *
 * Four of them carry CLAUDE CODE's name, and that is the whole point: `permissions` in a
 * `.claude/settings.json` addresses tools by name — `Bash(ls:*)`, `Read(./src/**)` — and
 * `permissionRulesFromSettings` passes that name straight into the rule it builds, with no mapping
 * (`translate` returns `{ tool, action }`). A rule naming `Bash` can only match a tool named `Bash`.
 *
 * Measured 2026-09-17 against Claude Code on byte-identical configuration: it refused a `deny` rule
 * that this product honoured with the file's canary. The divergent names were not cosmetic — they
 * were the reason a pasted settings file addressed nothing at all.
 *
 * The rest keep their own names because they have no one-to-one counterpart. Renaming `ApplyPatch`
 * to `Write`, or `ViewImage` to `Read`, would make a pasted rule address the WRONG capability, which
 * is worse than addressing none: the operator would believe a control is in force over something it
 * does not cover.
 */
export const REGISTRY_TOOL_NAMES = [
  'Read',
  'Glob',
  'Grep',
  'RepoStatus',
  'GitDiff',
  'CurrentTime',
  'ViewImage',
  'ApplyPatch',
  'Edit',
  'Bash',
] as const

export type RegistryToolName = (typeof REGISTRY_TOOL_NAMES)[number]

export class ToolRegistry {
  readonly #toolset: Toolset<CustomTool>

  constructor(scope: ToolScope) {
    /**
     * The tools come from the framework's coding preset, scoped once. `workspace-write` is passed
     * on purpose: this registry always holds the write tools and the shell and the role or mode
     * selects among them later, while the confinement is `scope.sandbox`, which the preset binds into
     * every tool, so a mode that grants no writes still cannot write. Reads honour absolute paths, and
     * the two write tools take `scope.writeRoot` as their root with relative paths resolving against
     * the project (#939). `UpdatePlan` is the preset's, not this registry's.
     */
    const { tools } = codingAgentTools({
      cwd: scope.cwd,
      sandboxMode: 'workspace-write',
      sandbox: scope.sandbox,
      writeRoot: scope.writeRoot,
      allowAbsolute: true,
      ...(scope.defaultTimeoutMs !== undefined && { defaultTimeoutMs: scope.defaultTimeoutMs }),
    })
    const wanted: ReadonlySet<string> = new Set(REGISTRY_TOOL_NAMES)
    const entries = new Map<string, CustomTool>(
      tools.filter((tool) => wanted.has(tool.name)).map((tool) => [tool.name, tool]),
    )
    for (const tool of entries.values()) Object.freeze(tool)
    for (const [name, tool] of entries) {
      if (tool.name !== name) {
        throw new ConfigurationError(
          `tool registered as "${name}" but named "${tool.name}" — the name is a contract with the model`,
          { code: 'tool_name_mismatch' },
        )
      }
    }
    this.#toolset = Toolset.from([...entries.values()])
  }

  names(): string[] {
    return [...this.#toolset.names()]
  }

  get(name: RegistryToolName): CustomTool {
    return this.#toolset.get(name)
  }

  resolve(names: readonly string[]): CustomTool[] {
    return [...this.#toolset.resolve(names)]
  }
}
