import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Regression guard (#85 follow-up / fixture drift) — `fixtures/template-default/app/page.tsx` is a
 * build/e2e mirror of the canonical scaffold template. They MUST stay identical so the fixture never
 * drifts (it once lagged the #80 ChatMessage-auto-dispatch migration, still importing ToolCallCard).
 */
describe('fixture template page stays in sync with the canonical template', () => {
  it('fixtures/template-default/app/page.tsx === create-theokit template app/page.tsx', () => {
    const root = resolve(__dirname, '../..')
    const fixture = readFileSync(resolve(root, 'fixtures/template-default/app/page.tsx'), 'utf-8')
    const template = readFileSync(
      resolve(root, 'packages/create-theokit/templates/default/app/page.tsx'),
      'utf-8',
    )
    expect(fixture).toBe(template)
  })
})
