// examples/code-assistant — the writer with a HUMAN GATE (tutorial Step 6).
//
// Reading is safe; writing files is not. This agent asks before it mutates the repo: mark the
// write tool `@HumanInTheLoop` and the run pauses before it runs — the stream emits an approval
// request and stays paused until a human approves via `POST /api/agents/coder/approve/<approvalId>`.
// `@Checkpoint` persists the conversation so a same-session follow-up resumes instead of restarting;
// `@MainLoop` runs a bounded read→plan→act→reflect loop. @theokit/sdk stays the only runtime — these
// decorators are metadata the harness adapts (no LLM call, no second loop lives here).
import { Agent, Toolbox, Tool, HumanInTheLoop, Checkpoint, Mixin, MainLoop } from '@theokit/agents'
import { z } from 'zod'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

@Toolbox({ namespace: 'fs' })
class WriteTools {
  @Tool({
    name: 'write_file',
    description: 'Write UTF-8 content to a path relative to the project root.',
    input: z.object({ path: z.string(), content: z.string() }),
  })
  @HumanInTheLoop({
    question: 'Approve writing this file?',
    timeout: 300_000,
    onTimeout: 'abort', // a timed-out approval is a denial — never write on silence
  })
  async writeFile(input: { path: string; content: string }): Promise<string> {
    await writeFile(resolve(process.cwd(), input.path), input.content, 'utf8')
    return `Wrote ${input.path} (${input.content.length} bytes).`
  }
}

@Agent({
  name: 'coder',
  route: '/coder',
  model: 'anthropic/claude-sonnet-4-6',
  systemPrompt:
    'You are a coding agent. Read before you write. When you write a file, keep the diff minimal ' +
    'and explain the change — the human reviews your write before it lands.',
})
@Checkpoint({ storage: 'filesystem', strategy: 'after-tool-call' })
@Mixin(WriteTools) // its @HumanInTheLoop tool becomes a gate on this agent
export default class CoderAgent {
  @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 10 })
  async run(): Promise<void> {}
}
