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
import { type Capability, type CompiledAgentOptionsDraft, setOnce } from './capability.js'
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
   * Pre-spawn approval for hooks that setting sources load. Defaults to refusing every one: a hook is
   * arbitrary shell, and trusting the directory is not approving each command.
   */
  readonly hookApproval?: NonNullable<CompiledAgentOptionsDraft['hookApproval']>
}

const DEFAULT_GATES: Readonly<Record<string, HumanInTheLoopOptions>> = {
  ApplyPatch: { question: 'Apply this file patch?' },
  Edit: { question: 'Apply this edit?' },
  Bash: { question: 'Run this shell command?' },
  interactive_shell: { question: 'Start this interactive session?' },
  write_stdin: { question: 'Send this input to the interactive session?' },
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

function toolsFor(options: CodingAgentPresetOptions): CustomTool[] {
  const { cwd, sandboxMode } = options
  const sandbox = options.sandbox ?? createSandboxBackend({ mode: sandboxMode, workDir: cwd })
  const bound = bindToolScope({ projectRoot: cwd, sandbox, mode: sandboxMode })
  const tools: CustomTool[] = [
    withName(bound.bind(createReadFileTool)({ lineNumbers: true }), 'Read'),
    withName(bound.bind(createListDirTool)(), 'Glob'),
    withName(bound.bind(createSearchTextTool)({ regex: true }), 'Grep'),
    bound.bind(createGitStatusTool)({ name: 'RepoStatus' }),
    withName(bound.bind(createGitDiffTool)(), 'GitDiff'),
    withName(createCurrentTimeTool(), 'CurrentTime'),
    withName(bound.bind(createViewImageTool)(), 'ViewImage'),
    createUpdatePlanTool(),
  ]
  // `writableRootsFor` is the SDK's own answer; `[]` means no writable root, `null` means everything.
  const roots = writableRootsFor(sandboxMode, cwd) as readonly string[] | null | undefined
  if (roots === undefined) {
    throw new ConfigurationError(`codingAgentPreset: unknown sandbox mode "${sandboxMode}"`)
  }
  if (roots !== null && roots.length === 0) return tools
  tools.push(
    withName(bound.bind(createApplyPatchTool)(), 'ApplyPatch'),
    withName(bound.bind(createEditFileTool)(), 'Edit'),
    // `sandbox` comes from the bound scope, so the shell cannot be assembled unconfined.
    withName(bound.bind(createShellTool)(), 'Bash'),
  )
  if (options.interactive !== undefined) {
    tools.push(
      createInteractiveShellTool({ interactive: options.interactive }),
      createWriteStdinTool({ interactive: options.interactive }),
    )
  }
  return tools
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
  const tools = toolsFor(options)
  const names = new Set(tools.map((tool) => tool.name))

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

  const trusted = options.posture.allows.projectSettings
  const members: Capability[] = [
    new ToolsCapability(tools),
    new GatesCapability(gates),
    new WithheldBuiltinToolsCapability(['shell']),
    // `project` is OMITTED rather than passed with a denying posture: the gate throws on a requested
    // but ungranted root, and an untrusted directory should degrade to user-only, not fail.
    new SettingSourcesCapability(
      trusted ? { user: true, project: { trustedBy: options.posture } } : { user: true },
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
