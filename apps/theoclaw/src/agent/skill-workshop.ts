import { type InlineSkill, Skill } from '@theokit/sdk'

/**
 * OC-73 (B-390, REQ-12): a skill the agent wrote stays inactive until its example has run and
 * passed. A failing example, or one that throws, keeps it inactive.
 */
export interface SkillDraft {
  readonly name: string
  readonly description: string
  readonly instructions: string
  /** What proves the skill works; handed to the runner as is. */
  readonly example: string
}

export interface ExampleResult {
  readonly passed: boolean
  readonly output?: string
}

/** Executes a skill's example. The app wires a real runner; tests wire a deterministic one. */
export type ExampleRunner = (draft: SkillDraft) => Promise<ExampleResult>

export type SkillState = 'inactive' | 'active'

export interface AuthoredSkill {
  readonly name: string
  readonly state: SkillState
  readonly reason?: string
}

export class SkillWorkshop {
  private readonly entries = new Map<string, { state: SkillState; skill: InlineSkill; reason?: string }>()

  constructor(private readonly runExample: ExampleRunner) {}

  /** Records the draft inactive, runs its example, and activates it only on a pass. */
  async author(draft: SkillDraft): Promise<AuthoredSkill> {
    if (draft.example.trim() === '') return this.record(draft, 'inactive', 'no example')
    let result: ExampleResult
    try {
      result = await this.runExample(draft)
    } catch (error) {
      return this.record(draft, 'inactive', `example threw: ${error instanceof Error ? error.message : String(error)}`)
    }
    return result.passed ? this.record(draft, 'active') : this.record(draft, 'inactive', result.output ?? 'example failed')
  }

  /** The skills a session may load: only those whose example passed. */
  loadable(): InlineSkill[] {
    return [...this.entries.values()].filter((entry) => entry.state === 'active').map((entry) => entry.skill)
  }

  status(name: string): AuthoredSkill | undefined {
    const entry = this.entries.get(name)
    return entry === undefined ? undefined : { name, state: entry.state, ...(entry.reason === undefined ? {} : { reason: entry.reason }) }
  }

  private record(draft: SkillDraft, state: SkillState, reason?: string): AuthoredSkill {
    // Re-authoring replaces the earlier version: a new body must earn activation again.
    const skill = Skill.create({ name: draft.name, description: draft.description, instructions: draft.instructions })
    this.entries.set(draft.name, { state, skill, ...(reason === undefined ? {} : { reason }) })
    return { name: draft.name, state, ...(reason === undefined ? {} : { reason }) }
  }
}
