# Edge Case Review — m67-layered-boundary-passthrough

Date: 2026-08-12
Tasks analyzed: 7 (T0–T6)
Cases found: 9 (EDGE: 5, NEGATIVE: 4 | MUST FIX: 4, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: o teste de piso mede a DECLARAÇÃO, não a instalação

- **Affected task:** T1
- **Kind:** NEGATIVE (o teste passa enquanto a realidade está errada)
- **Family:** State
- **Scenario:** `sdk-floor.test.ts` lê os três `package.json` e afirma que nenhum range admite
  < 4.49.0. Se o `pnpm install` não for executado, ou se o `pnpm-lock.yaml` não for regravado, o
  range declarado é `^4.49.0` e a versão **instalada** continua 4.40.0. O teste fica verde; o
  `node_modules` está errado; o re-export de T3 explode em runtime.
- **Impact:** exatamente o defeito que este milestone existe para fechar — declarado divergindo do
  testado — reintroduzido pelo próprio gate do milestone. E com agravante: é o gate que deveria
  provar a correção.
- **Suggested fix:** o teste passa a afirmar **as duas coisas**: o range declarado E a versão
  resolvida —
  `expect(require('@theokit/sdk/package.json').version).toSatisfy(v => gte(v, '4.49.0'))`.

### EC-2: `toBe` sobre um símbolo que é TYPE-only devolve `undefined` nos dois lados

- **Affected task:** T3 (e a inconsistência com T4)
- **Kind:** EDGE (dois dos oito são de uma espécie diferente)
- **Family:** Format
- **Scenario:** T3 manda afirmar `expect(barrel.X).toBe(sdk.X)` para **os oito**. `WiredEntity` e
  `ToolResultContentBlock` são tipos: em runtime, `barrel.WiredEntity` é `undefined` e
  `sdk.WiredEntity` também. `undefined === undefined` → **verde**. O teste passa sem provar nada, e
  passaria igualmente se o re-export não existisse.
- **Impact:** falso positivo em 2 dos 8 símbolos — um quarto da cobertura do milestone. T4 já separa
  valor de tipo; T3 contradiz T4 dentro do mesmo plano.
- **Suggested fix:** T3 afirma `toBe` apenas sobre os **seis valores**; os dois tipos saem da
  asserção de valor e ficam exclusivamente em `expectTypeOf` (T4), com comentário nomeando por quê.

### EC-3: a enumeração da barra root não enxerga exports type-only

- **Affected task:** T5
- **Kind:** EDGE (o limite do mecanismo de enumeração)
- **Family:** Boundary
- **Scenario:** `createRequire(...)('@theokit/sdk')` devolve o objeto de runtime. Todo `export type`
  do SDK é apagado na compilação e **não aparece** em `Object.keys`. A tabela ROOT-BAR então afirma
  "todo export da barra root tem veredito" cobrindo só os valores — e um tipo novo da barra root
  entra sem veredito, em silêncio.
- **Impact:** o gate dá garantia mais forte do que entrega. É a mesma classe de buraco que o
  milestone fecha (um eixo não enumerado), reproduzida um nível abaixo.
- **Suggested fix:** o teste declara seu escopo no nome e no motivo — `test_every_root_bar_VALUE_has_a_verdict`
  — e a cobertura de tipos passa a vir do `.d.ts` via `attw`/`tsc --emitDeclarationOnly` ou fica
  registrada como lacuna conhecida com sunset. Prometer menos e cumprir, em vez de prometer tudo.

### EC-4: elevar um `peerDependency` é breaking para o consumidor, e o plano trata como `Changed`

- **Affected task:** T6 (e T1)
- **Kind:** NEGATIVE (contrato quebrado sem sinalização)
- **Family:** Permission / contrato
- **Scenario:** `theokit` e `@theokit/presenter` publicam `peerDependencies["@theokit/sdk"]`. Subir o
  piso de `^4.40.0` para `^4.49.0` faz o install de um app pinado em 4.42 passar a emitir erro/aviso
  de peer não satisfeito. Isso é mudança de contrato de instalação, não melhoria interna.
- **Impact:** consumidor quebra no `install` sem que o CHANGELOG tenha avisado que precisava subir.
- **Suggested fix:** o CHANGELOG declara explicitamente "piso de peer elevado — consumidores precisam
  de `@theokit/sdk >= 4.49.0`", e o changeset é **minor com nota de breaking de peer** (ou major se a
  política do repo assim exigir) — decidido em T6, não deixado implícito.

## SHOULD TEST

### EC-5: `^4.49.0` admite qualquer 4.x futura, inclusive uma que remova um símbolo

- **Affected task:** T1
- **Kind:** EDGE (o topo do range válido)
- **Suggested test:** `test_root_bar_passthrough_holds_against_the_resolved_version` — o teste de T3
  já roda contra a versão resolvida, então uma futura 4.52 que remova um dos oito fica vermelha no
  CI. Nenhum teste novo é preciso; o que falta é **declarar** essa dependência no plano, para que
  ninguém "conserte" o vermelho afrouxando a asserção em vez de investigar a remoção.

### EC-6: um gate de paridade vermelho pode ser mal classificado

- **Affected task:** T2
- **Kind:** NEGATIVE (falha silenciosa por decisão humana errada)
- **Suggested test:** não é teste — é procedimento. T2 exige que cada vermelho seja registrado no log
  de implementação com sua classificação (símbolo novo sem veredito × mudança de comportamento) e a
  evidência que a sustenta. Sem o registro, "classificamos como benigno" é indistinguível de "não
  olhamos".

### EC-7: o lockfile pode resolver duas cópias se um pacote ficar para trás

- **Affected task:** T1
- **Kind:** EDGE (o limite da resolução do workspace)
- **Suggested test:** `test_the_workspace_resolves_exactly_one_sdk_copy` — afirma que
  `find node_modules/.pnpm -maxdepth 1 -name '@theokit+sdk@*'` devolve exatamente uma entrada. É o
  cenário que o ADR-0051 usa para rejeitar o bump parcial; hoje o plano o rejeita por argumento e não
  o verifica.

## DOCUMENT

### EC-8: `check-wire-parity.mjs` lê `packages/presenter/dist/`

- **Kind:** EDGE (ordenação de build, não de código)
- **Accepted risk:** já registrado como Unresolved Question 3 do plano. O gate exige `dist` construído;
  se T2 rodar antes do build, o vermelho é de ordenação e não de regressão. Aceito porque o custo é
  uma linha de ordem no comando, e resolvê-lo antecipadamente seria adivinhar o modo de falha.

### EC-9: a tabela ROOT-BAR pode nascer com dezenas de `out` preenchidos mecanicamente

- **Kind:** NEGATIVE (o gate atendido na letra e traído no espírito)
- **Accepted risk:** o plano já mitiga com o mínimo de 20 caracteres no motivo, e o risco residual —
  vinte motivos plausíveis escritos sem pensar — não tem defesa mecânica. Fica como item de revisão
  humana no `/review`, declarado aqui para que o revisor saiba onde olhar.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-----:|---------:|---------:|------------:|---------:|
| T0 | 0 | 0 | 0 | 0 | 0 |
| T1 | 2 | 1 | 2 | 2 | 0 |
| T2 | 0 | 1 | 0 | 1 | 1 |
| T3 | 1 | 0 | 1 | 0 | 0 |
| T4 | 0 | 0 | 0 | 0 | 0 |
| T5 | 1 | 0 | 1 | 0 | 1 |
| T6 | 0 | 1 | 1 | 0 | 0 |

**Coverage check:** T1, T3 e T5 são as tasks com fronteira de entrada real (manifest, barrel, SDK) e
todas as três receberam ao menos uma lente EDGE e uma NEGATIVE. T0 e T4 não têm fronteira de entrada
— T0 é documento, T4 é asserção sobre o resultado de T3. T2 é medição: tem lente NEGATIVE (o vermelho
mal classificado) e nenhuma EDGE aplicável.

**Verdict:** PLAN NEEDS ADJUSTMENT — 4 MUST FIX, sendo que EC-1 e EC-2 são defeitos que fariam o
milestone fechar com gate verde e contrato não verificado.
