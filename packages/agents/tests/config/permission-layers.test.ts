import { PermissionEngine } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { permissionRulesFromSettings } from '../../src/config/settings-permissions.js'
import { permissionRulesFromLayers } from '../../src/config/settings-roots.js'

const read = (block: Parameters<typeof permissionRulesFromSettings>[0]) => ({
  permissionRules: permissionRulesFromSettings(block).rules,
})

describe('permission rules from several layers', () => {
  it('a deny in the project file wins over an allow in the user file', () => {
    const user = read({ allow: ['Bash(curl:*)'] })
    const project = read({ deny: ['Bash(curl:*)'] })
    const engine = new PermissionEngine(permissionRulesFromLayers([user, project]), {
      defaultAction: 'ask',
    })
    expect(engine.evaluate('Bash', { command: 'curl x' })).toBe('deny')
  })

  it('keeps file order inside one action and skips absent reads', () => {
    const a = read({ allow: ['Read', 'Write'] })
    const b = read({ allow: ['Edit'], deny: ['Bash'] })
    const rules = permissionRulesFromLayers([a, undefined, b])
    expect(rules.map((r) => `${r.action}:${r.tool}`)).toEqual([
      'deny:Bash',
      'allow:Read',
      'allow:Write',
      'allow:Edit',
    ])
  })
})

describe('toolAliases', () => {
  it('Bash(ls:*) allows shell_exec with ls -la', () => {
    const { rules } = permissionRulesFromSettings(
      { allow: ['Bash(ls:*)'] },
      { toolAliases: { Bash: 'shell_exec' } },
    )
    const engine = new PermissionEngine(rules, { defaultAction: 'deny' })
    expect(engine.evaluate('shell_exec', { command: 'ls -la' })).toBe('allow')
    expect(engine.evaluate('Bash', { command: 'ls -la' })).toBe('deny')
  })
})
