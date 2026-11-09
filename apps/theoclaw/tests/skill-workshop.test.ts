import { describe, expect, it } from 'vitest'

import { type ExampleRunner, SkillWorkshop } from '../src/agent/skill-workshop.js'

const runner: ExampleRunner = async (draft) => ({ passed: draft.example === 'echo ok', output: `ran ${draft.example}` })
const draft = (name: string, example: string) => ({ name, description: `${name} skill`, instructions: 'do it', example })

describe('SkillWorkshop (REQ-12)', () => {
  it('makes only the skill whose example passes loadable', async () => {
    const shop = new SkillWorkshop(runner)
    expect((await shop.author(draft('good', 'echo ok'))).state).toBe('active')
    expect((await shop.author(draft('bad', 'echo no'))).state).toBe('inactive')
    expect(shop.loadable().map((s) => s.name)).toEqual(['good'])
    expect(shop.status('bad')?.reason).toBe('ran echo no')
  })

  it('keeps a skill inactive when the example throws or is missing', async () => {
    const shop = new SkillWorkshop(async () => {
      throw new Error('boom')
    })
    expect((await shop.author(draft('t', 'x'))).reason).toBe('example threw: boom')
    expect((await shop.author(draft('e', '  '))).reason).toBe('no example')
    expect(shop.loadable()).toEqual([])
  })

  it('deactivates a skill re-authored with a failing example', async () => {
    const shop = new SkillWorkshop(runner)
    await shop.author(draft('s', 'echo ok'))
    await shop.author(draft('s', 'echo no'))
    expect(shop.loadable()).toEqual([])
  })
})
