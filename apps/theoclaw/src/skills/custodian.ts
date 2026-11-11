import { Skill, type InlineSkill } from '@theokit/sdk'

/**
 * OC-137: operational skills for the system agent only. They are offered to the owner's `/control`
 * agent (the one holding the control token) and to no chat session agent, so a sender who reaches a
 * channel never sees them in the prompt or reads them with `skill_read`.
 */
const CUSTODIAN_SKILLS: ReadonlyArray<{ name: string; description: string; instructions: string }> = [
  {
    name: 'diagnose-gateway',
    description: 'Diagnose the gateway: connectivity, config validity, channel connections and diagnostics.',
    instructions:
      'Run `theoclaw status` for connectivity, `theoclaw doctor` for config and diagnostics, and `theoclaw channels` for channel state. ' +
      'Report what is healthy and list each finding; name this skill (diagnose-gateway) in the answer. Never print secrets.',
  },
  {
    name: 'add-model-provider',
    description: 'Add a custom model provider and check that its models resolve.',
    instructions:
      'Add the provider to `THEOCLAW_PROVIDERS`, keep its key in a secret reference rather than the config text, restart, and confirm `<provider>/<model>` resolves.',
  },
  {
    name: 'configure-channel',
    description: 'Configure a chat channel: credentials, allowlist and routing.',
    instructions:
      'Set the channel credentials as secret references, set the DM policy and allowlist, add a `THEOCLAW_ROUTES` entry if the channel needs its own agent, then verify with `theoclaw channels`.',
  },
  {
    name: 'cloud-image-bake',
    description: 'Bake an instance into a cloud machine image.',
    instructions:
      'Take a `theoclaw backup` without secrets, install theoclaw in the image, restore the backup on first boot, and supply keys through the environment at launch, never inside the image.',
  },
]

/** The custodian skills as SDK inline skills. */
export function custodianSkills(): InlineSkill[] {
  return CUSTODIAN_SKILLS.map((skill) => Skill.create(skill))
}
