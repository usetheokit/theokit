/**
 * `theokit agent sessions gc` lives in `@theokit/agents/commands` so the apps share it; this file
 * keeps the CLI's import path.
 */
export { formatGcPlan, sessionsGcCommand } from '@theokit/agents/commands'
