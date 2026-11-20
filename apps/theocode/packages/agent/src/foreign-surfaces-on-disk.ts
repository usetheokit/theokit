import { foreignSurfaceInventory } from '@theokit/agents'

import type { ForeignSurface } from './doctor/doctor.js'

/**
 * The surfaces under `.claude/` this product reports. The scan itself — what each loader would
 * take, which entries cannot be read — is the framework's `foreignSurfaceInventory`; what stays here
 * is the choice of which surfaces a TheoCode operator is told about, and that `workflows` is refused.
 */
const REPORTED: ReadonlySet<string> = new Set([
  'agents',
  'commands',
  'agent-memory',
  'workflows',
  'plugins',
])

/**
 * What the foreign root holds, one entry per surface that actually has files.
 *
 * An absent root, an absent surface and an empty one all yield nothing: none of the three is a
 * finding, and reporting them would make the rows that matter harder to see.
 */
export function foreignSurfacesOnDisk(cwd: string): ForeignSurface[] {
  return foreignSurfaceInventory({ cwd })
    .filter((entry) => REPORTED.has(entry.dir) && entry.count > 0)
    .map((entry) => ({ dir: entry.dir, files: entry.count, state: entry.state }))
}
