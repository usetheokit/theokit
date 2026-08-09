import { describe, expect, it, vi } from 'vitest'

import { AgentBuilder } from '../../src/index.js'
import { project, resolveProjection } from '../../src/bridge/definition-or-thunk.js'

/**
 * M91 T1.1 — `toAgentFactory` aceita um THUNK de definição.
 *
 * ## O que estava errado
 *
 * O parâmetro `apiKey` já aceitava thunk desde o M74, adicionado por **exatamente** esta razão. O `def`
 * não aceitava, e a assimetria tinha uma linha de largura — mas custava: com a forma objeto, trust,
 * hooks, skills e MCP são compilados no load do módulo e ficam **congelados para o processo inteiro**.
 *
 * Num `theokit acp` que uma IDE mantém aberto por horas, isso reintroduz a obsolescência que o M67
 * removeu ao mover a construção da definição para o entry point. O M67 fechou metade; esta é a outra.
 *
 * ## Por que os testes medem CONTAGEM DE PROJEÇÕES e não o handle
 *
 * Construir o handle exige o runtime do SDK e uma credencial. O invariante que importa é anterior a
 * isso: **quantas vezes a definição é projetada**. Uma vez para N sessões (forma objeto, comportamento
 * preservado) versus uma vez por sessão (forma thunk, o que ela compra). `resolverProjecao` é o seam
 * que decide isso, e é onde o teste morde.
 */
describe('M91 — resolveProjection decides between the object shape and the thunk', () => {
  const agentDef = (): ReturnType<typeof AgentBuilder.create>['build'] extends () => infer D
    ? D
    : never => AgentBuilder.create().model('openai/gpt-4o-mini').system('oi').build() as never

  it('the OBJECT shape projects ONCE, regardless of how many sessions', async () => {
    const def = agentDef()
    const spy = vi.fn(() => def)
    // `resolverProjecao` recebe o objeto direto; o espião conta chamadas ao thunk, que aqui não existe.
    const projectPerSession = resolveProjection(def as never, {})
    const a = await projectPerSession('s1')
    const b = await projectPerSession('s2')
    expect(spy).not.toHaveBeenCalled()
    // Mesma referência: a projeção é reaproveitada, não recalculada.
    expect(b).toBe(a)
  })

  it('the THUNK shape projects PER SESSION — the point of the milestone', async () => {
    const def = agentDef()
    const calls: string[] = []
    const projectPerSession = resolveProjection((id: string) => {
      calls.push(id)
      return def as never
    }, {})
    await projectPerSession('s1')
    await projectPerSession('s2')
    expect(calls).toEqual(['s1', 's2'])
  })

  it('the thunk receives the real sessionId, not a placeholder', async () => {
    const def = agentDef()
    const seen: string[] = []
    const projectPerSession = resolveProjection((id: string) => {
      seen.push(id)
      return def as never
    }, {})
    await projectPerSession('sessao-x')
    expect(seen).toEqual(['sessao-x'])
  })

  it('an ASYNC thunk is awaited before projecting', async () => {
    const def = agentDef()
    const projectPerSession = resolveProjection(async () => {
      await Promise.resolve()
      return def as never
    }, {})
    const p = await projectPerSession('s1')
    expect(p.model).toBe('openai/gpt-4o-mini')
  })

  it('COUNTERPROOF — two projections of the thunk are distinct instances', async () => {
    const def = agentDef()
    const projectPerSession = resolveProjection(() => def as never, {})
    const a = await projectPerSession('s1')
    const b = await projectPerSession('s2')
    expect(b).not.toBe(a)
  })

  it('overrides.model beats the model of the definition, in both shapes', async () => {
    const def = agentDef()
    const eager = await resolveProjection(def as never, { model: 'anthropic/claude' })('s1')
    const lazy = await resolveProjection(() => def as never, { model: 'anthropic/claude' })('s1')
    expect(eager.model).toBe('anthropic/claude')
    expect(lazy.model).toBe('anthropic/claude')
  })

  it('projecting applies the default when neither definition nor override has a model', () => {
    // Construído como DADO, não pelo builder: `build()` recusa em tempo de compilação quando falta
    // modelo (o parâmetro vira `MissingModelError`), então o estado é inalcançável pela API fluente.
    // O default de `projetar` existe para definições que chegam por outro caminho — `defineAgent`, um
    // módulo de agente em disco — e `AgentDefinition` é dado puro desde o M79, então isto é legítimo.
    const semModelo = { name: 'sem-modelo', system: 'oi', tools: [] }
    const p = project(semModelo as never, {})
    expect(p.model).toBe('openai/gpt-4o-mini')
  })
})
