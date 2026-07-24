---
slug: no-backcompat-concessions
date: 2026-07-24
generated_by: roadmap-feature
questions_answered: 4
unresolved_dims: []
status: completed
---

# Roadmap-feature grill: no-backcompat-concessions

> **Origem das respostas (honestidade):** o owner leu o relatório de fechamento do M55, listou os
> pontos onde eu havia **preservado compatibilidade** em vez de fazer a correção de raiz, e
> determinou: *"NÃO IMPORTA O ESFORÇO, NÃO VAMOS TER RETROCOMPATIBILIDADE"*. As quatro dimensões
> abaixo derivam dessa diretriz, e cada número foi **medido**, não estimado.

### Q0 (cross-check obrigatório): algum item de `### Explicitly out of scope` é violado?

**Um item é ADJACENTE e precisa de ressalva explícita:** *"Breaking the `@theokit/http` decorator
path"*. O M56 toca `packages/http`, mas **apenas 4 tipos exportados órfãos** (`RouteInfo`,
`ActionDefinition`, `ActionRegistry`, `CssResource`, `ServerInsertedHTML`) que não são alcançáveis de
nenhuma entry do pacote — ou seja, nenhum consumidor externo consegue importá-los hoje. O **path de
decorators de controller** (`@Controller`, `@Get`, `@UseGuards`, …) permanece **intacto**, e a suíte
de 411 testes do `http` é o gate que prova isso. Sem violação.

Os demais itens travados (virar SDK, reimplementar loop/orquestração, dispatch engine, framework de
signals, sandbox embutido, RSC, abstração de provider) não têm interseção com remoção de código morto
e política de gate.

### Q1/4: o que é esta feature e por que AGORA (o que mudou)?

**O que é:** remover **toda** concessão de retrocompatibilidade feita durante o M55, e fazer as
correções de raiz que essas concessões evitaram.

**O que mudou:** o M55 fechou com seis compromissos conscientes, cada um deles motivado por *não
quebrar quem já consome*. O owner removeu essa restrição. Cada concessão, medida:

| # | Concessão do M55 | Correção de raiz | Tamanho medido |
|---|---|---|---|
| A | `ConfigurationError` reexportado de `capability/capabilities.ts` "para nenhum consumidor mudar" | importadores passam a usar `src/errors.ts`; reexport removido | ~20 arquivos |
| B | `ToolboxCapability.compile()` mantido por ser API pública, apesar de **zero** chamadores no monorepo | deletado (parcimônia rung 1) | 1 método + o teste que criei para ele |
| C | `knip-exports.json` escopado a `packages/agents` para não mexer em 6 workspaces | `exports`/`types` = `error` no `knip.json` real; override deletado | **109 arquivos, 25 exports, 170 types** (`theo` 95, `create-theokit` 4, `agents` 6, `http` 4) |
| D | 8 devDependencies não usadas reportadas como followup | removidas | 5 na raiz, 3 em `packages/theo` |
| E | Dois `throw new Error` genéricos em `compileTools` (achado F-arch-4 do review) | tipados como `ConfigurationError` | 2 sítios |
| F | `check:direction` vermelho por `packages/tauri` declarar `theokit` | dependência removida | 2 declarações |

**Por que AGORA:** B e C são a **mesma patologia que o M55 existiu para corrigir**, deixada de pé por
compatibilidade. B é um método público com zero chamadores — código morto, o defeito que o M55
caçava. C é a política que tornava o gate cego: o M55 provou que `rules.exports: "off"` faz "knip
limpo" passar com órfão presente, e resolveu isso **só para um pacote**. Manter os outros cinco cegos
é preservar exatamente o buraco que acabamos de documentar.

### Q2/4: quais milestones precisam estar `[x]` antes desta feature começar?

**M55** (`[x]`, `@theokit/agents@1.1.0`). Todas as seis concessões foram criadas nele; o M56 é a sua
correção de raiz e opera sobre o código que ele deixou.

**M54 NÃO é dependência, mas há uma interseção a respeitar:** `AgentRunnerSpec`
(`loop/agent-runner.ts`) aparece na lista de tipos órfãos, e é justamente o tipo que o M54
(`loop-strategy-seam`) vai estender. A regra para o M56: tipo órfão que um milestone **aberto**
declara como superfície de trabalho é **allowlistado com sunset citando o milestone**, nunca deletado.

### Q3/4: qual é a Definition of Done verificável?

Ver o bloco `### M56` no `ROADMAP.md`. Dois gates duros: `pnpm knip` **verde no repositório inteiro**
(hoje sai 1) sem nenhum override de config, e `pnpm check:direction` **verde** (hoje sai 1).

### Q4/4: quais são os 2 riscos NOVOS que esta feature introduz?

1. **Remoção de tipo público que alguém fora do repo importa.** Os 170 tipos são invisíveis a
   consumidores externos (nenhum é alcançável de uma entry — é por isso que o knip os acusa), mas o
   raio é grande: 95 arquivos em `packages/theo`, o pacote principal. Mitigação: remover **apenas o
   `export`**, mantendo o tipo no arquivo, sempre que houver uso interno; `tsc --noEmit` na raiz +
   as suítes dos 4 pacotes são o gate; e o major bump comunica.
2. **Ligar `types: "error"` pode virar ruído permanente.** Um tipo de vocabulário público
   legitimamente sem consumidor interno seria acusado para sempre, empurrando o time a allowlistar em
   massa — o oposto do objetivo. Mitigação: se após a limpeza sobrar categoria recorrente legítima,
   `types` volta a `off` **com ADR declarando por quê**, e só `exports` fica em `error`. A decisão é
   tomada com o número na mão depois da limpeza, não agora.
