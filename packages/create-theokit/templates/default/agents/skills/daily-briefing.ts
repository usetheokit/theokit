import { createSkill } from '@theokit/sdk'

/**
 * A real, code-defined skill (`createSkill`) — a documented procedure the MODEL can pull in on demand.
 *
 * Unlike a loose Markdown note, this is wired into the agent: `agents/chat.ts` passes it to
 * `defineSkillReadTool([...])`, which gives the model a `skill_read` tool. The model sees the skill's
 * name + description in every turn (cheap) and calls `skill_read('daily-briefing')` to load the full
 * `instructions` only when it actually needs them — so long procedures don't bloat every prompt.
 *
 * Lives in `agents/skills/` — a semantic folder the route scanner skips, so it never becomes an endpoint.
 */
export const dailyBriefingSkill = createSkill({
  name: 'daily-briefing',
  description:
    "Produce a short 'good morning' briefing (today's date, the weather, and a one-line nudge).",
  instructions: `# Daily briefing

Trigger: the user asks for a "briefing", "morning update", or "what's my day looking like".

Steps:
1. Ask for (or reuse) the user's city and IANA timezone if you don't already have them.
2. Call the \`current_time\` tool with their timezone → the local date and time.
3. Call the \`weather\` tool with their city → the current conditions.
4. Reply in exactly three lines:
   - **Today** — weekday + date (from current_time).
   - **Weather** — conditions + temperature (from weather).
   - **Nudge** — one short, friendly suggestion based on the weather.

Never invent the time or weather — always call the tools. Keep it to three lines unless asked for more.`,
})
