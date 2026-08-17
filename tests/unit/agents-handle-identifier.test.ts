import { describe, it, expect } from 'vitest'
import {
  generateAgentsDts,
  generateAgentsRuntimeModule,
  handleIdentifier,
} from '../../packages/theo/src/vite-plugin/agents-typed-client.js'

/**
 * An agent's name comes from its file path, so kebab-case is normal and correct — the name is also
 * the URL segment (`agents/ask-theo.ts` → `POST /api/agents/ask-theo`).
 *
 * Emitting it verbatim as an exported binding produced `export const ask-theo`, which does not
 * parse. The generated `.theokit/agents.d.ts` broke every tool reading it, and the runtime module
 * emitted the same syntax error as executable code (usetheokit/theokit#318). The bug survived
 * because the fixtures only ever used single-word names.
 */

describe('handleIdentifier', () => {
  it('leaves a single-word name alone', () => {
    // Every name that already worked must keep working — this is not a rename.
    expect(handleIdentifier('chat')).toBe('chat')
    expect(handleIdentifier('support')).toBe('support')
  })

  it('camelCases a hyphenated name', () => {
    expect(handleIdentifier('ask-theo')).toBe('askTheo')
    expect(handleIdentifier('code-review-bot')).toBe('codeReviewBot')
  })

  it('camelCases a nested path', () => {
    expect(handleIdentifier('internal/triage')).toBe('internalTriage')
  })

  it('handles dots and underscores', () => {
    expect(handleIdentifier('v1.chat')).toBe('v1Chat')
    expect(handleIdentifier('my_agent')).toBe('my_agent')
  })

  it('prefixes a leading digit, which is not a valid identifier start', () => {
    expect(handleIdentifier('2fa')).toBe('_2fa')
  })

  it('always produces something a JS parser accepts', () => {
    const names = ['ask-theo', 'internal/triage', '2fa', 'a-b-c-d', 'chat', 'v1.chat']

    for (const name of names) {
      const identifier = handleIdentifier(name)
      expect(identifier, `"${name}" → "${identifier}"`).toMatch(/^[A-Za-z_$][\w$]*$/)
    }
  })
})

describe('generated output for a hyphenated agent', () => {
  const manifest = {
    agents: [{ name: 'ask-theo', filePath: 'agents/ask-theo.ts' }],
  } as Parameters<typeof generateAgentsDts>[0]['manifest']

  it('emits a parseable declaration', () => {
    const dts = generateAgentsDts({
      manifest,
      dtsOutPath: '/project/.theokit/agents.d.ts',
      projectRoot: '/project',
    })

    expect(dts).toContain('export const askTheo: AgentHandle<')
    expect(dts).not.toContain('export const ask-theo')
    // The URL keeps the kebab form — the identifier changes, the route must not.
    expect(dts).toContain("'ask-theo': {")
  })

  it('emits a parseable runtime module, and keeps the route kebab-cased', () => {
    const js = generateAgentsRuntimeModule(['ask-theo'])

    expect(js).toContain("export const askTheo = agentHandle('/api/agents/ask-theo')")
    expect(js).not.toContain('export const ask-theo')
  })

  it('declares only valid identifiers, whatever the agent names are', () => {
    const js = generateAgentsRuntimeModule(['ask-theo', 'chat', 'internal/triage', '2fa'])
    const declared = [...js.matchAll(/^export const (\S+) =/gm)].map((match) => match[1])

    expect(declared).toHaveLength(4)
    for (const identifier of declared) {
      // The exact check the JS grammar applies to a binding name. `ask-theo` fails it, which is
      // why the generated module used to be a syntax error rather than code.
      expect(identifier, `"${identifier}" is not a valid binding name`).toMatch(
        /^[A-Za-z_$][\w$]*$/,
      )
    }
  })
})
