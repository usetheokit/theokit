import type { InlineSkill } from '@theokit/sdk'

import type { TrustPosture } from '../config/trust-posture.js'
import { namedSubagentDefinitions } from '../delegation/named-subagents.js'
import type { AgentDefinitionLike } from '../delegation/named-subagents.js'
import { userSkills } from '../context/user-skills.js'

/**
 * The two things read from disk before the chain is built: the operator's skills, and the subagents
 * on disk with their memory applied.
 *
 * Together because they are read at the same moment and for the same reason — once, at the
 * composition root, so the builder and any record of what was wired cannot disagree. Extracted
 * because `buildChatAgent` is a composition function with a line budget, and it is right that a
 * budget refuses a second disk read rather than absorbing it.
 */
export async function diskEntities(
  cwd: string,
  operatorHome: string,
  posture: TrustPosture,
): Promise<{
  operatorSkills: InlineSkill[]
  namedSubagents: Record<string, AgentDefinitionLike>
}> {
  const [operatorSkills, namedSubagents] = await Promise.all([
    userSkills(operatorHome),
    namedSubagentDefinitions(cwd, posture.allows.subagents),
  ])
  return { operatorSkills, namedSubagents }
}
