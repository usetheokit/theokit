import type { TrustPosture } from '@theokit/sdk'
import type { CustomTool } from '@theokit/sdk'
import type { InteractiveBackend } from '@theokit/sdk/interactive'
import {
  createSandboxBackend,
  writableRootsFor,
  type SandboxMode,
  type SandboxProvider,
} from '@theokit/sdk/sandbox'
import {
  createApplyPatchTool,
  createCurrentTimeTool,
  createEditFileTool,
  createGitDiffTool,
  createGitStatusTool,
  createInteractiveShellTool,
  createListDirTool,
  createReadFileTool,
  createSearchTextTool,
  createShellTool,
  createUpdatePlanTool,
  createViewImageTool,
  createWriteStdinTool,
  withName,
} from '@theokit/sdk-tools'

import type { SubagentAgentDefinition } from '../bridge/define-agent.js'
import type { CompatSurface } from '../bridge/setting-sources-gate.js'
import { ConfigurationError } from '../errors.js'
import { bindToolScope } from '../tools/tool-scope.js'
import type { HumanInTheLoopOptions } from '../types.js'

import {
  HookApprovalCapability,
  McpServersCapability,
  SubagentsCapability,
  SettingSourcesCapability,
  SkillsOptionsCapability,
  WithheldBuiltinToolsCapability,
} from './agent-capabilities.js'
import { ToolsCapability } from './capabilities.js'
import {
  type Capability,
  type CompiledAgentOptionsDraft,
  type OffTool,
  OffToolsCapability,
  setOnce,
} from './capability.js'
import { CapabilityPreset } from './registry.js'

type McpServers = NonNullable<CompiledAgentOptionsDraft['mcpServers']>

export interface CodingAgentPresetOptions {
  /** The project root every tool reads from (and writes to, when the mode allows writes). */
  readonly cwd: string
  /** `read-only` registers no write tool and no shell; the other modes register both. */
  readonly sandboxMode: SandboxMode
  /**
   * The trust evidence for `cwd`. Everything the repository itself can steer the agent with (project
   * MCP servers, skills, subagents, `.theokit/` and `.claude/` setting sources, hooks) is wired only
   * when it grants `projectSettings`; otherwise only the operator's own `~/.theokit/` is read.
   */
  readonly posture: TrustPosture<'projectSettings'>
  /**
   * Overrides for the approval card of a gated tool, keyed by tool name. Defaults gate every
   * side-effecting tool the preset registers (`ApplyPatch`, `Edit`, `Bash`, `interactive_shell`,
   * `write_stdin`); a name the preset did not register is refused. The gate is DECLARED here and
   * ENFORCED by the approval posture the surface passes to the bridge — an agent with no posture
   * fails closed there.
   */
  readonly approvals?: Readonly<Record<string, HumanInTheLoopOptions>>
  /**
   * The interactive backend (a PTY). Without one no `interactive_shell` / `write_stdin` is registered,
   * and none is ever registered in `read-only` mode.
   */
  readonly interactive?: InteractiveBackend
  /** Overrides the confinement; defaults to the sandbox backend of `sandboxMode` over `cwd`. */
  readonly sandbox?: SandboxProvider
  /** Project MCP servers (e.g. from `.mcp.json`). Dropped unless the posture grants `projectSettings`. */
  readonly mcpServers?: McpServers
  /** Project skills to enable by name. Dropped unless the posture grants `projectSettings`. */
  readonly skills?: readonly string[]
  /** Project subagents. Dropped unless the posture grants `projectSettings`. */
  readonly subagents?: Readonly<Record<string, SubagentAgentDefinition>>
  /**
   * Import surfaces of the Claude Code dialect (`<cwd>/.claude/`). Granted under the same
   * `projectSettings` posture as the rest; with a denying posture it is dropped, not thrown on.
   */
  readonly claudeCode?: { readonly import: readonly CompatSurface[] }
  /**
   * Pre-spawn approval for hooks that setting sources load. Defaults to refusing every one: a hook is
   * arbitrary shell, and trusting the directory is not approving each command.
   */
  readonly hookApproval?: NonNullable<CompiledAgentOptionsDraft['hookApproval']>
  /**
   * The root the write tools (`ApplyPatch`, `Edit`) and the shell are scoped to, when it differs from
   * `cwd` (`danger-full-access`). Relative paths still resolve against `cwd`. Defaults to `cwd`.
   */
  readonly writeRoot?: string
  /** Lets `Read`, `Glob` and `Grep` honour an absolute path outside `cwd`. Defaults to `false`. */
  readonly allowAbsolute?: boolean
  /** The `Bash` timeout when a call does not pass one. */
  readonly defaultTimeoutMs?: number
  /** A `web_fetch` tool the caller built; registered under approval in every mode. */
  readonly webFetch?: CustomTool
  /** A `web_search` tool the caller built (only when a provider is configured); registered under approval. */
  readonly webSearch?: CustomTool
  /** A `delegate_to_team` tool the caller built; registered under approval, and only when the mode allows writes. */
  readonly delegateToTeam?: CustomTool
}

const DEFAULT_GATES: Readonly<Record<string, HumanInTheLoopOptions>> = {
  ApplyPatch: { question: 'Apply this file patch?' },
  Edit: { question: 'Apply this edit?' },
  Bash: { question: 'Run this shell command?' },
  interactive_shell: { question: 'Start this interactive session?' },
  write_stdin: { question: 'Send this input to the interactive session?' },
  web_fetch: { question: 'Fetch this URL?' },
  web_search: { question: 'Search the web for this?' },
  delegate_to_team: {
    question: 'Delegate this task to the team (the worker may edit/run files)?',
  },
}

/** Sets the HITL gate map for the registered tools only. */
class GatesCapability implements Capability {
  readonly name = 'coding-agent-approvals'
  constructor(private readonly gates: ReadonlyMap<string, HumanInTheLoopOptions>) {}
  apply(draft: CompiledAgentOptionsDraft): void {
    if (this.gates.size === 0) return
    setOnce(draft, 'hitl', new Map(this.gates), this.name)
  }
}

function readOnlyOff(mode: SandboxMode, delegates: boolean): OffTool[] {
  const reason = `the ${mode} sandbox grants no writes`
  const names = ['ApplyPatch', 'Edit', 'Bash', 'interactive_shell', 'write_stdin']
  if (delegates) names.push('delegate_to_team')
  return names.map((name) => ({ name, reason }))
}

/** The tools {@link codingAgentPreset} registers, and the ones it leaves off with the reason each is. */
export interface CodingAgentTools {
  readonly tools: CustomTool[]
  readonly off: OffTool[]
  /** The approval gate of each side-effecting tool registered: the defaults with `approvals` applied. */
  readonly gates: ReadonlyMap<string, HumanInTheLoopOptions>
}

/** The tool half of {@link codingAgentPreset}, for a consumer that composes its own agent around the tools. */
export function codingAgentTools(
  options: Omit<CodingAgentPresetOptions, 'posture'>,
): CodingAgentTools {
  const built = buildCodingTools(options)
  const names = new Set(built.tools.map((tool) => tool.name))
  const gates = new Map<string, HumanInTheLoopOptions>()
  for (const [tool, gate] of Object.entries(DEFAULT_GATES))
    if (names.has(tool)) gates.set(tool, gate)
  for (const [tool, gate] of Object.entries(options.approvals ?? {})) {
    if (!names.has(tool)) {
      throw new ConfigurationError(
        `codingAgentPreset: approval for "${tool}", which this preset did not register in ` +
          `${options.sandboxMode} mode (registered: ${[...names].join(', ')})`,
      )
    }
    gates.set(tool, gate)
  }
  return { ...built, gates }
}

function buildCodingTools(options: Omit<CodingAgentPresetOptions, 'posture'>): {
  tools: CustomTool[]
  off: OffTool[]
} {
  const { cwd, sandboxMode } = options
  const sandbox = options.sandbox ?? createSandboxBackend({ mode: sandboxMode, workDir: cwd })
  const bound = bindToolScope({
    projectRoot: cwd,
    ...(options.writeRoot !== undefined && { writeRoot: options.writeRoot }),
    sandbox,
    mode: sandboxMode,
  })
  const absolute = options.allowAbsolute === true ? { allowAbsolute: true } : {}
  const tools: CustomTool[] = [
    withName(bound.bind(createReadFileTool)({ lineNumbers: true, ...absolute }), 'Read'),
    withName(bound.bind(createListDirTool)(absolute), 'Glob'),
    withName(bound.bind(createSearchTextTool)({ regex: true, ...absolute }), 'Grep'),
    bound.bind(createGitStatusTool)({ name: 'RepoStatus' }),
    withName(bound.bind(createGitDiffTool)(), 'GitDiff'),
    withName(createCurrentTimeTool(), 'CurrentTime'),
    withName(bound.bind(createViewImageTool)(), 'ViewImage'),
    createUpdatePlanTool(),
  ]
  for (const extra of [options.webFetch, options.webSearch])
    if (extra !== undefined) tools.push(extra)
  const off: OffTool[] = []
  // `writableRootsFor` is the SDK's own answer; `[]` means no writable root, `null` means everything.
  const roots = writableRootsFor(sandboxMode, cwd) as readonly string[] | null | undefined
  if (roots === undefined) {
    throw new ConfigurationError(`codingAgentPreset: unknown sandbox mode "${sandboxMode}"`)
  }
  if (roots !== null && roots.length === 0) {
    return { tools, off: readOnlyOff(sandboxMode, options.delegateToTeam !== undefined) }
  }
  // The write tools take the write root as THEIR project root; relative paths resolve against `cwd`.
  const writeScope =
    options.writeRoot !== undefined ? { projectRoot: options.writeRoot, baseDir: cwd } : {}
  tools.push(
    withName(bound.bind(createApplyPatchTool)(writeScope), 'ApplyPatch'),
    withName(bound.bind(createEditFileTool)(writeScope), 'Edit'),
    // `sandbox` comes from the bound scope, so the shell cannot be assembled unconfined.
    withName(
      bound.bind(createShellTool)(
        options.defaultTimeoutMs !== undefined
          ? { defaultTimeoutMs: options.defaultTimeoutMs }
          : {},
      ),
      'Bash',
    ),
  )
  if (options.interactive !== undefined) {
    tools.push(
      createInteractiveShellTool({ interactive: options.interactive }),
      createWriteStdinTool({ interactive: options.interactive }),
    )
  } else {
    for (const name of ['interactive_shell', 'write_stdin']) {
      off.push({ name, reason: 'no interactive backend was supplied' })
    }
  }
  if (options.delegateToTeam !== undefined) tools.push(options.delegateToTeam)
  return { tools, off }
}

/**
 * The coding agent, as ONE capability: read/search/git/image tools always; write, shell and (with a
 * backend) interactive tools only when `sandboxMode` allows writes; the SDK's built-in shell withheld
 * so the confined `Bash` is the only way to run a command; an approval gate on each side-effecting
 * tool; and every disk-sourced feature behind the trust posture.
 *
 * ```ts
 * const draft = applyCapabilities([
 *   new ModelCapability('openai/gpt-5.4'),
 *   codingAgentPreset({ cwd, sandboxMode: 'workspace-write', posture }),
 * ])
 * ```
 */
export function codingAgentPreset(options: CodingAgentPresetOptions): CapabilityPreset {
  const { tools, off, gates } = codingAgentTools(options)

  const trusted = options.posture.allows.projectSettings
  const members: Capability[] = [
    new ToolsCapability(tools),
    new GatesCapability(gates),
    new OffToolsCapability(off),
    new WithheldBuiltinToolsCapability(['shell']),
    // `project` is OMITTED rather than passed with a denying posture: the gate throws on a requested
    // but ungranted root, and an untrusted directory should degrade to user-only, not fail.
    new SettingSourcesCapability(
      trusted
        ? {
            user: true,
            project: { trustedBy: options.posture },
            ...(options.claudeCode !== undefined && {
              claudeCode: { trustedBy: options.posture, import: options.claudeCode.import },
            }),
          }
        : { user: true },
    ),
    new HookApprovalCapability(options.hookApproval ?? { approve: () => false }),
  ]
  if (trusted) {
    if (options.mcpServers !== undefined) members.push(new McpServersCapability(options.mcpServers))
    if (options.skills !== undefined && options.skills.length > 0) {
      members.push(new SkillsOptionsCapability({ include: [...options.skills] }))
    }
    if (options.subagents !== undefined) members.push(new SubagentsCapability(options.subagents))
  }
  return new CapabilityPreset('preset:coding-agent', members)
}
