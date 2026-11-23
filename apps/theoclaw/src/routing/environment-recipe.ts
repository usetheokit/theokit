/**
 * Environment recipes for cloud workers (OC-123): the checkout on a provisioned machine is prepared
 * by exactly one recipe before the agent starts. Detection and execution are the framework's
 * `prepareWorkspace` (devcontainer, setup script, lockfile install); this file only names the
 * TheoClaw setup scripts it should look for, after the devcontainer files.
 */
import { prepareWorkspace, type RecipeExec, type WorkspaceRecipe } from '@theokit/agents/bridge'

export type { RecipeExec, WorkspaceRecipe }

const SETUP_SCRIPTS = ['.openclaw/worktree-setup.sh', '.theoclaw/worktree-setup.sh']

/** Detect and run the single recipe for a checkout; resolves to it, or `undefined` when it has none. */
export function prepareEnvironment(root: string, exec?: RecipeExec): Promise<WorkspaceRecipe | undefined> {
  return prepareWorkspace(root, { setupScripts: SETUP_SCRIPTS, ...(exec ? { exec } : {}) })
}
