# Deps Audit — tool-name-single-source

Date: 2026-07-24
Plan: `knowledge-base/plans/tool-name-single-source-plan.md`
Baseline sha: `271124d5`
Scanner: `pnpm audit` (Regra Inquebrável 9 — scanner do ecossistema, nunca reimplementado)

## Escopo do plano

| Categoria | Contagem | Detalhe |
|---|---|---|
| Dependências **novas** | **0** | O plano não adiciona nenhuma. A única "ferramenta nova" é `knip-exports.json`, um arquivo de config para um pacote **já instalado** (`knip@^5.88.1`) — parcimônia rung 4 |
| Dependências **removidas** | 0 | As remoções de T3.2 são código morto interno, não dependências |
| Dependências **existentes** usadas | 3 | `knip@^5.88.1` (devDep raiz), `vitest` (devDep), `@theokit/sdk@4.1.0` (o contrato espelhado) |

Como nenhuma dependência é introduzida, **nenhum CVE é introduzido por este plano**. O restante deste relatório é o estado medido da árvore, registrado por honestidade — não por imputação ao M55.

## Estado da árvore no baseline (pré-existente)

```
pnpm audit --prod  →  1 vulnerabilidade (1 low)
pnpm audit         → 15 vulnerabilidades (10 high | 4 moderate | 1 low)
```

Todos os achados são **transitivos e de dev-tooling**. A árvore de produção está essencialmente limpa: o único achado com `--prod` é o mesmo `esbuild` low, alcançado via `fixtures/`.

| Severidade | Pacote | Natureza |
|---|---|---|
| high | `brace-expansion` | DoS por expansão exponencial |
| high | `js-yaml` | DoS quadrático em merge-key |
| high | `shell-quote` | DoS de complexidade quadrática no parse |
| high | `immutable` | overflow de trie 32-bit → DoS |
| high | `fast-uri` | host confusion em canonicalização IDN |
| high | `sharp` | vulnerabilidades herdadas do libvips |
| moderate | `esbuild` | dev-server aceita requests de qualquer site |
| moderate | `uuid` | falta de bounds check em v3/v5/v6 |
| moderate | `js-yaml` | DoS quadrático (variante) |
| low | `esbuild` | leitura arbitrária de arquivo no dev-server (Windows) |

Nenhum deles é dependência **declarada** deste plano, e nenhum é alcançável em runtime a partir de `@theokit/agents` — são DoS/parse em ferramentas de build e teste, executadas localmente e em CI sobre entrada confiável.

## Avaliação por `deps-audit-golden-rule.md`

| Hard cap (§ 3) | Estado |
|---|---|
| 1 — golden rule existe e parseia | ✅ `.claude/rules/deps-audit-golden-rule.md` |
| 2 — allowlist parseia | ✅ `.claude/rules/deps-audit-allowlist.txt` sem erro de sintaxe |
| 3 — nenhuma dep **declarada** com CVE CRITICAL/HIGH | ✅ o plano declara **zero** deps novas; as 3 existentes que ele usa não são a origem dos achados HIGH |
| 4 — seção `## Dependencies` presente e completa no plano | ✅ com subseções Existing / New / Removed e coluna de justificativa Rule 9 |

**Verdict: `PASS_WITH_CAVEATS`.**

O caveat é explícito e **não é atribuível ao M55**: a árvore de dev do repositório carrega 10 CVEs HIGH pré-existentes. Bloquear o M55 neles significaria absorver dívida alheia enquanto um defeito **vivo em produção** (`namespace: 'mcp'` produz agente que o `Agent.create` rejeita) continua no ar — troca ruim, e seria precisamente o tipo de decisão que este ciclo existe para evitar.

## Followups (não bloqueiam o M55)

1. **Atualizar a árvore de dev** para eliminar os 10 HIGH. A maioria some com bump de `vitest`/`tsup`/`sharp`; requer uma rodada própria de verificação porque mexe no toolchain de build de 6 workspaces.
2. **`esbuild >= 0.28.1`** fecha os dois achados de `esbuild` (moderate + low) de uma vez — provavelmente via bump de `vite`.

Registrado, não mascarado: nenhuma entrada foi adicionada a `deps-audit-allowlist.txt`, porque allowlist é para exceção justificada com sunset, e o correto aqui é **corrigir**, não isentar.
