import { ConfigurationError, Toolset } from '@theokit/agents'
import type { CustomTool } from '@theokit/agents'
import { bindToolScope } from '@theokit/agents/tool-scope'
import type { SandboxBackend } from '@theokit/agents/sandbox'
import {
  createApplyPatchTool,
  createCurrentTimeTool,
  createViewImageTool,
  createEditFileTool,
  createGitDiffTool,
  createGitStatusTool,
  createListDirTool,
  createReadFileTool,
  createSearchTextTool,
  createShellTool,
  withName,
} from '@theokit/agents/tools'

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
     * The scope is BOUND once, and the factories inherit it.
     *
     * `projectRoot: scope.cwd` used to be repeated across seven entries and `sandbox` on one. Every
     * repetition is a place to forget — and forgetting `sandbox` on `createShellTool` produces an
     * UNCONFINED SHELL with no error and no warning, which is the defect B-006 documented here.
     *
     * The two WRITE tools pass `projectRoot: scope.writeRoot` explicitly. Not a detail: for them the
     * project root IS the write root, and letting the bind apply `cwd` would narrow the write scope
     * silently whenever the two diverge.
     */
    const bound = bindToolScope({
      projectRoot: scope.cwd,
      writeRoot: scope.writeRoot,
      sandbox: scope.sandbox,
    })

    const entries = new Map<string, CustomTool>([
      [
        'Read',
        withName(
          bound.bind(createReadFileTool)({ lineNumbers: true, allowAbsolute: true }),
          'Read',
        ),
      ],
      [
        'Glob',
        withName(bound.bind(createListDirTool)({ allowAbsolute: true }), 'Glob'),
      ],
      [
        'Grep',
        withName(bound.bind(createSearchTextTool)({ regex: true, allowAbsolute: true }), 'Grep'),
      ],
      ['RepoStatus', bound.bind(createGitStatusTool)({ name: 'RepoStatus' })],
      ['GitDiff', withName(bound.bind(createGitDiffTool)(), 'GitDiff')],
      ['CurrentTime', withName(createCurrentTimeTool(), 'CurrentTime')],
      // B-082 — the model can look at a diagram or screenshot itself, under the same read root.
      // The 53-line local version was DELETED when `@theokit/agents@12.1.0` started forwarding this
      // built-in: the local one threw for the SDK to convert, where the built-in returns typed
      // `path_traversal` / `not_found` / `unsupported_image_type` / `image_too_large`; it hard-coded
      // no size ceiling, where the built-in defaults to 5 MB with the reason written down (base64
      // inflates by 4/3 straight into the model's context); and it applied the SE17 split by hand,
      // which the factory now does. The upstream note is the argument for deleting rather than
      // keeping: "an image reader that honours any path is a file exfiltration primitive with a
      // friendly name" — not code to maintain one copy of per product.
      ['ViewImage', withName(bound.bind(createViewImageTool)(), 'ViewImage')],
      // Explicit override: for a write tool, the project root IS the write root.
      [
        'ApplyPatch',
        withName(bound.bind(createApplyPatchTool)({ projectRoot: scope.writeRoot }), 'ApplyPatch'),
      ],
      [
        'Edit',
        withName(bound.bind(createEditFileTool)({ projectRoot: scope.writeRoot }), 'Edit'),
      ],
      [
        'Bash',
        withName(
          // `sandbox` comes from the bound scope — no path here can forget it.
          bound.bind(createShellTool)(
            scope.defaultTimeoutMs !== undefined
              ? { defaultTimeoutMs: scope.defaultTimeoutMs }
              : {},
          ),
          'Bash',
        ),
      ],
    ])
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
