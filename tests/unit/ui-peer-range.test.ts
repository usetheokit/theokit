import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * O peer opcional `@theokit/ui` de `theokit` tem de aceitar TODA a linha que o template canônico pina.
 *
 * ## O defeito real que este guarda existe para pegar
 *
 * V3-2 nasceu de um ERESOLVE: o peer estava em `^0.14.0` e o consumidor adotou `@theokit/ui@0.18.1`.
 * npm é estrito com conflito de peer opcional (pnpm é leniente, e foi por isso que o dogfood em pnpm
 * não pegou), então um `npx create-theokit` recém-scaffoldado falhava o `npm install`.
 *
 * ## Por que ele estava vermelho, e o que mudou
 *
 * A primeira versão fixava LITERAIS: `0.14.x`, `0.18.x`, `0.19.0`, `1.0.0`. O commit `f09fbbac`
 * (2026-07-16) estreitou o peer para `^1.1.0` e **derrubou de propósito** as cláusulas 0.x — a linha
 * foi descontinuada no pivot AI-exclusive. As asserções de literal passaram a exigir compatibilidade
 * com uma linha que o time removeu conscientemente, e o guarda ficou vermelho por default. Um guarda
 * permanentemente vermelho não protege nada: ele treina o time a ignorar vermelho.
 *
 * Mover os literais de `0.x` para `1.x` só empurraria o apodrecimento uma casa. A propriedade que o
 * guarda sempre quis expressar é **coerência**: o piso do peer não pode ficar ACIMA do piso que o
 * template pina, senão um lockfile que resolva o piso do template dá ERESOLVE no primeiro install.
 * É isso que ele verifica agora, e não precisa de edição quando a linha legitimamente avança.
 * Mesmo padrão aplicado ao guarda da fixture no M67. Backlog B-M67-01, itens 1-4.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const theoPkg = JSON.parse(
  readFileSync(resolve(__dirname, '../../packages/theo/package.json'), 'utf-8'),
) as { peerDependencies?: Record<string, string> }
const templateTmpl = readFileSync(
  resolve(__dirname, '../../packages/create-theokit/templates/default/package.json.tmpl'),
  'utf-8',
)

/** `^X.Y.Z` → `[X, Y, Z]`. Retorna `undefined` para qualquer outra forma. */
function caretParts(pin: string): [number, number, number] | undefined {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(pin.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

/**
 * Semântica de caret do npm, sem depender de `semver` (escada de parcimônia, degrau 4 — a checagem
 * cabe em uma comparação lexicográfica de tupla).
 *
 * `^X.Y.Z` com X > 0 é `>=X.Y.Z <(X+1).0.0`. Para `^0.Y.Z` o caret fixa o MINOR: `>=0.Y.Z <0.(Y+1).0`.
 * A versão anterior desta função aproximava por "compartilha o major", o que fazia `^1.1.0` aceitar
 * `1.0.0` — verde pelo motivo errado, exatamente o que o guarda existe para não deixar acontecer.
 */
function caretAccepts(pin: string, version: [number, number, number]): boolean {
  const base = caretParts(pin)
  if (base === undefined) return false
  const [bMaj, bMin, bPat] = base
  const [vMaj, vMin, vPat] = version
  if (bMaj !== vMaj) return false
  if (bMaj === 0 && bMin !== vMin) return false
  // Dentro da janela do caret, a versão ainda precisa ser >= o piso.
  if (vMin !== bMin) return vMin > bMin
  return vPat >= bPat
}

/** Uma versão satisfaz um range `^A || ^B` quando satisfaz ao menos uma cláusula. */
function rangeAccepts(range: string, version: [number, number, number]): boolean {
  return range.split('||').some((part) => caretAccepts(part, version))
}

describe('@theokit/ui peer range (V3-2)', () => {
  const range = theoPkg.peerDependencies?.['@theokit/ui']
  const templatePin = /"@theokit\/ui":\s*"([^"]+)"/.exec(templateTmpl)?.[1]

  it('test_ui_peer_is_declared', () => {
    expect(range, '@theokit/ui must remain an optional peer of theokit').toBeTruthy()
  })

  it('test_the_default_template_pins_a_single_caret', () => {
    // Se o template pinasse um range aberto (`*`, `>=1`), a asserção de coerência abaixo não teria
    // piso para comparar — e o scaffold poderia resolver qualquer coisa.
    expect(templatePin, 'o template canônico deve declarar @theokit/ui').toBeTruthy()
    expect(caretParts(templatePin!), `pin do template não é um caret: ${templatePin}`).toBeTruthy()
  })

  it('test_ui_peer_accepts_the_whole_line_the_template_pins', () => {
    // A propriedade que importa: um `npx create-theokit` recém-scaffoldado tem de instalar — inclusive
    // com um lockfile que resolva o PISO do range do template, não só o `latest` do dia.
    const floor = caretParts(templatePin!)!
    expect(
      rangeAccepts(range!, floor),
      `o peer "${range}" recusa ${floor.join('.')}, o piso que o template pina ("${templatePin}") — ` +
        `um lockfile nesse piso quebraria o install com ERESOLVE`,
    ).toBe(true)
  })

  it('test_the_next_major_is_not_accepted_implicitly', () => {
    // O range é uma série de carets OR-joined, uma por linha VALIDADA (ADR 0018) — nunca um range
    // aberto. Um major novo entra por decisão explícita, não por herança.
    const floor = caretParts(templatePin!)!
    expect(rangeAccepts(range!, [floor[0] + 1, 0, 0])).toBe(false)
  })

  it('test_caretAccepts_rejects_the_shapes_that_are_not_carets', () => {
    // Lente negativa: a helper é o oráculo dos testes acima. Se ela aceitasse qualquer coisa, eles
    // ficariam verdes sem provar nada — foi assim que a aproximação anterior passou despercebida.
    for (const notACaret of ['1.1.0', '~1.1.0', '>=1.1.0', '*', '^1.1', '^1', '']) {
      expect(caretAccepts(notACaret, [1, 1, 0]), `deveria rejeitar "${notACaret}"`).toBe(false)
    }
  })

  it('test_caretAccepts_honours_the_floor_within_the_window', () => {
    expect(caretAccepts('^1.1.0', [1, 0, 0])).toBe(false) // abaixo do piso
    expect(caretAccepts('^1.1.0', [1, 1, 0])).toBe(true) // exatamente o piso
    expect(caretAccepts('^1.1.0', [1, 3, 2])).toBe(true) // dentro da janela
    expect(caretAccepts('^1.1.0', [2, 0, 0])).toBe(false) // major seguinte
    expect(caretAccepts('^0.14.0', [0, 14, 9])).toBe(true) // 0.x: caret fixa o minor
    expect(caretAccepts('^0.14.0', [0, 15, 0])).toBe(false)
  })
})
