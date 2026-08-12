# Code-Quality Audit — m67-layered-boundary-passthrough

**Data:** 2026-08-12 · **Modo:** plan-bound · **Linguagens auditadas:** typescript

## Verdict

**PASS** — `score_cap: 100`, zero findings em qualquer severidade.

```json
{ "verdict": "PASS", "score_cap": 100, "hard_caps_triggered": [], "soft_caps_triggered": [],
  "severity_counts": { "HARD": 0, "SOFT_CAP": 0, "SOFT_FLOOR": 0, "INFO": 0 } }
```

Vale registrar por que este PASS é diferente dos anteriores: os ADRs **0033, 0034 e 0035** dispensaram
uma baseline de 8 findings D2 três vezes, e cada um nomeou a mesma correção como a durável antes de
adiá-la. Este milestone a implementou (duas linhas no detector, com teste de regressão antes do fix),
então o PASS aqui não é uma dispensa — é a ausência real de findings. Nenhum ADR de dispensa foi
necessário, e o quarto que estaria disponível não foi escrito.

## Gates complementares

| Gate | Resultado | Observação |
|---|---|---|
| `tsc --noEmit` (monorepo) | **exit 0** | Nove minors aditivas de SDK atravessaram sem uma incompatibilidade de assinatura |
| `eslint --max-warnings=0` (arquivos do M67) | **exit 0** | Dois problemas encontrados e corrigidos: `.sort()` sem comparador (`sonarjs/no-alphabetical-sort`) e um `require_` órfão |
| `check-auth-parity.mjs` | OK | Exigiu decisão para `assertSecureModes`; registrada como `re-exported` e verificada contra o entry |
| `check-sandbox-parity.mjs` | OK | — |
| `check-wire-parity.mjs` | OK | — |
| `check-package-direction.mjs` | OK | G1 intacta — nenhuma aresta nova no DAG |
| `check-ai-free-surface.mjs` | OK | G2 intacta — re-exportar não é reimplementar |
| Suíte `@theokit/agents` | **932 passed / 3 skipped, exit 0** | 129 arquivos |

## knip (G7 — todo export tem consumidor)

`pnpm knip` sai com código 1, e **nenhum dos achados é do M67**. Verificado por grep sobre os doze
símbolos que este milestone publicou (`foldLayers`, `verifyLayerOrdering`, `applySecurityFloor`,
`resolveTrustPosture`, `auditEnvReachability`, `recordWiring`, `WiredEntity`,
`ToolResultContentBlock`, `classifySessionArtifact`, `SessionArtifact`, `atomicWriteTempTarget`,
`writableRootsFor`, `assertSecureModes`): zero ocorrências na saída.

Os achados existentes vivem todos em arquivos não tocados por este milestone — `scanWebSocketRoutes`
(`theo/src/server/internal-api.ts`), oito tipos exportados sem consumidor
(`auth/device-provider.ts`, `bridge/approval-posture.ts`, `bridge/definition-or-thunk.ts`,
`bridge/mcp-file.ts`, `cli/commands/build/emit-controllers.ts`, `vite-plugin/integrate-studio.ts`) e a
duplicata declarada do M91 em `bridge/delegation-types.ts`. São baseline anterior, registrados na
task dos vermelhos pré-existentes em vez de consertados oportunisticamente aqui.

## Observação de flakiness

`packages/agents/tests/unit/subpath-coverage.test.ts::test_the_symbols_of_._CROSS_the_layer` falhou
por timeout de 5000 ms numa execução e passou nas seguintes **sem mudança de código entre elas**. Pela
`rules/testing.md § 3` isso é bug, não ruído tolerável. Não corrigido aqui por ser pré-existente e
fora do escopo declarado; registrado com causa provável (a fase de `collect` do vitest chegou a 81 s
nesta máquina, e 5000 ms é apertado para um teste que enumera o barrel inteiro).

## O que este audit NÃO cobre

- **A suíte da raiz** é medida separadamente (`t7-root-suite-after.log`), porque a config raiz inclui
  apenas `tests/**` da raiz e não alcança `packages/*/tests/**`. Foi essa separação que deixou as
  falhas de paridade do pacote `agents` invisíveis na primeira medição do T2.
- **Mutation testing (D4)** não roda neste repo para TypeScript — o detector declara
  `NotImplementedError`. Nenhuma afirmação sobre força de oráculo é feita aqui.
- **Detecção de exceção engolida** não é coberta por nenhum detector; é concern de `/review`.
