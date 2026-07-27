/**
 * M79 DoD 4 — `AgentDefinition` é um CONTRATO DE DADO PURO, atravessável entre cópias do pacote.
 *
 * ## O que este teste protege, e por que ele existe
 *
 * Durante três majors o agent-builder rodou com DUAS cópias de `@theokit/agents` no mesmo processo:
 * a autoria em 4.x e o transporte in-process em 0.44.x, porque o CLI publicado fixava a linha antiga.
 * Elas interoperavam — e a razão de terem conseguido é a única coisa que este arquivo trava:
 *
 *   `AgentDefinition` é **dado**, não instância. Ninguém faz `instanceof` nele.
 *
 * Se em algum momento a definição virasse uma `class` (ou o brand virasse um `unique symbol` local),
 * as duas cópias deixariam de se reconhecer — e a falha seria silenciosa no ponto errado: o objeto
 * chegaria "quase certo" ao transporte e só quebraria fundo, sem apontar a causa.
 *
 * ## O M79 fechou o skew — e isso NÃO torna o contrato dispensável
 *
 * Com o CLI publicado na linha 4.x há **uma** cópia hoje. Mas o contrato é o que permitiu sobreviver
 * ao skew, e é o que permitirá sobreviver ao próximo: qualquer consumidor que fixe uma faixa
 * diferente recria a condição. Um invariante só testado enquanto dói é um invariante que ninguém
 * percebe quebrar no intervalo.
 */
import { describe, expect, it } from 'vitest'

import { AGENT_BRAND, defineAgent, isAgentDefinition } from '../../src/bridge/define-agent.js'

describe('M79 — AgentDefinition atravessa cópias do pacote', () => {
  it('test_o_brand_vem_do_REGISTRO_GLOBAL_de_simbolos', () => {
    // `Symbol.for` resolve no registro global do runtime — a MESMA identidade de símbolo em duas
    // cópias do pacote carregadas no mesmo processo. Um `Symbol()` local (ou um `unique symbol` sem
    // `for`) daria dois símbolos distintos, e cada cópia rejeitaria a definição da outra.
    expect(AGENT_BRAND).toBe(Symbol.for('theokit.agent.definition'))
  })

  it('test_uma_definicao_construida_por_OUTRA_copia_e_reconhecida', () => {
    // Simula a outra cópia: um objeto puro carimbado com o símbolo do registro global, SEM passar
    // por `defineAgent` desta cópia. É exatamente o que o transporte in-process recebia.
    const deOutraCopia = {
      model: 'x',
      system: 'oi',
      [Symbol.for('theokit.agent.definition')]: true,
    }
    expect(
      isAgentDefinition(deOutraCopia),
      'a definição de outra cópia deixou de ser reconhecida — a interop cross-version quebrou',
    ).toBe(true)
  })

  it('test_a_definicao_NAO_e_instancia_de_classe', () => {
    // O invariante central. Se isto virar uma classe, `instanceof` passa a ser tentador no consumo —
    // e `instanceof` é exatamente o que NÃO atravessa duas cópias do mesmo pacote.
    const def = defineAgent({ model: 'x', system: 'oi' })
    expect(Object.getPrototypeOf(def)).toBe(Object.prototype)
  })

  it('test_CONTRAPROVA_um_objeto_SEM_o_brand_e_rejeitado', () => {
    // Sem esta, `isAgentDefinition` poderia devolver `true` para qualquer coisa e os testes acima
    // passariam. O reconhecimento tem de ser específico, não permissivo.
    expect(isAgentDefinition({ model: 'x', system: 'oi' })).toBe(false)
    expect(isAgentDefinition({ [Symbol('theokit.agent.definition')]: true })).toBe(false)
  })
})
