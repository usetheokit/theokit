import { describe, expect, it, vi } from 'vitest'

import { AgentBuilder } from '../../src/index.js'
import { projetar, resolverProjecao } from '../../src/bridge/definicao-ou-thunk.js'

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
describe('M91 — resolverProjecao decide entre forma objeto e thunk', () => {
  const definicao = (): ReturnType<typeof AgentBuilder.create>['build'] extends () => infer D ? D : never =>
    AgentBuilder.create().model('openai/gpt-4o-mini').system('oi').build() as never

  it('forma OBJETO projeta UMA vez, independente de quantas sessoes', async () => {
    const def = definicao()
    const espiao = vi.fn(() => def)
    // `resolverProjecao` recebe o objeto direto; o espião conta chamadas ao thunk, que aqui não existe.
    const projetarPorSessao = resolverProjecao(def as never, {})
    const a = await projetarPorSessao('s1')
    const b = await projetarPorSessao('s2')
    expect(espiao).not.toHaveBeenCalled()
    // Mesma referência: a projeção é reaproveitada, não recalculada.
    expect(b).toBe(a)
  })

  it('forma THUNK projeta POR SESSAO — e o ponto do milestone', async () => {
    const def = definicao()
    const chamadas: string[] = []
    const projetarPorSessao = resolverProjecao((id: string) => {
      chamadas.push(id)
      return def as never
    }, {})
    await projetarPorSessao('s1')
    await projetarPorSessao('s2')
    expect(chamadas).toEqual(['s1', 's2'])
  })

  it('o thunk recebe o sessionId real, nao um placeholder', async () => {
    const def = definicao()
    const vistos: string[] = []
    const projetarPorSessao = resolverProjecao((id: string) => {
      vistos.push(id)
      return def as never
    }, {})
    await projetarPorSessao('sessao-x')
    expect(vistos).toEqual(['sessao-x'])
  })

  it('thunk ASSINCRONO e aguardado antes de projetar', async () => {
    const def = definicao()
    const projetarPorSessao = resolverProjecao(async () => {
      await Promise.resolve()
      return def as never
    }, {})
    const p = await projetarPorSessao('s1')
    expect(p.model).toBe('openai/gpt-4o-mini')
  })

  it('CONTRAPROVA — duas projecoes do thunk sao instancias distintas', async () => {
    const def = definicao()
    const projetarPorSessao = resolverProjecao(() => def as never, {})
    const a = await projetarPorSessao('s1')
    const b = await projetarPorSessao('s2')
    expect(b).not.toBe(a)
  })

  it('overrides.model vence o modelo da definicao, nas duas formas', async () => {
    const def = definicao()
    const eager = await resolverProjecao(def as never, { model: 'anthropic/claude' })('s1')
    const lazy = await resolverProjecao(() => def as never, { model: 'anthropic/claude' })('s1')
    expect(eager.model).toBe('anthropic/claude')
    expect(lazy.model).toBe('anthropic/claude')
  })

  it('projetar aplica o default quando nem definicao nem override tem modelo', () => {
    // Construído como DADO, não pelo builder: `build()` recusa em tempo de compilação quando falta
    // modelo (o parâmetro vira `MissingModelError`), então o estado é inalcançável pela API fluente.
    // O default de `projetar` existe para definições que chegam por outro caminho — `defineAgent`, um
    // módulo de agente em disco — e `AgentDefinition` é dado puro desde o M79, então isto é legítimo.
    const semModelo = { name: 'sem-modelo', system: 'oi', tools: [] }
    const p = projetar(semModelo as never, {})
    expect(p.model).toBe('openai/gpt-4o-mini')
  })
})
