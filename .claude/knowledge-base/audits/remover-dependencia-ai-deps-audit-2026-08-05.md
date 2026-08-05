# Deps Audit — remover-dependencia-ai

Date: 2026-08-05
Plan: `knowledge-base/plans/remover-dependencia-ai-plan.md` (v1.1)
Mode: plan-bound
Ecossistema: npm (pnpm 9.15.0)

## Verdict: `PASS`

O plano **não adiciona nenhuma dependência externa nova**. As três que sua seção `## Dependencies`
declara estão limpas.

## Dependências declaradas pelo plano

| Pacote | Versão | Movimento | CVE | Resultado |
|---|---|---|---|---|
| `ai` | `7.0.14` (pin exato) | `dependencies`/`peer` → `devDependencies` | **nenhum** | ✅ |
| `zod` | `^4.4.3` (já declarada) | reuso, sem mudança | **nenhum** | ✅ |
| `@theokit/presenter` | `workspace:*` | `devDep` → `dep` + externalização (D7) | n/a (interno) | ✅ |

Ferramentas: `pnpm audit --prod --audit-level=high`, `osv-scanner` (ambas disponíveis; nenhuma
fabricação de saída limpa).

## Hard caps (deps-audit-golden-rule § 3)

| # | Check | Resultado |
|---|---|---|
| 1 | Golden rule presente e parseável | ✅ |
| 2 | Allowlist parseável | ✅ (sem entradas novas) |
| 3 | Nenhuma dep declarada com CVE CRITICAL/HIGH | ✅ |
| 4 | Plano tem `## Dependencies` completo | ✅ (adicionada na v1.1; a v1.0 não tinha, o que teria disparado `plan_missing_dependencies_section` → INVALID_PLAN_DEPS) |

## Achados FORA do escopo deste plano (pré-existentes no repo)

A varredura repo-wide encontrou 5 vulnerabilidades. **Nenhuma toca as dependências deste plano** —
não bloqueiam o `/plan-confidence` — mas são reais e ficam registradas:

| Severidade | Pacote | Advisory | Nota |
|---|---|---|---|
| **HIGH** | `react-router` | RSC Mode CSRF Bypass Allows Action Execution | **Merece atenção própria.** O TheoKit usa react-router v7 no roteador do app; um bypass de CSRF em modo RSC é diretamente relevante para o produto, ainda que o RSC esteja deferido past-1.0 (`CLAUDE.md § Architectural decisions`). Vale issue separada. |
| **HIGH** | `postcss` | Path Traversal in Previous Source Map Auto-Loading | Transitiva via `vitest → vite-node → vite` (74 caminhos) |
| MODERATE | `postcss` | Correção incompleta de GHSA-6g55-p6wh-862q | Mesma cadeia |
| LOW | `esbuild` | Leitura arbitrária de arquivo no dev server | Dev-only |

Honestidade sobre o alcance: `pnpm audit --prod` apontou `vitest` dentro da cadeia de produção via
`@theokit/sdk-tools`, o que sugere que o `sdk-tools` declara `vitest` como dependência real e não
como dev. Não investiguei a fundo — é um fio solto de outro escopo, anotado aqui para não se perder.

## Recomendação

Prosseguir para `/plan-confidence`. O `react-router` HIGH deve virar issue própria, com verificação
de se o modo RSC afetado está de fato alcançável na configuração do TheoKit (a decisão de arquitetura
registrada diz que RSC está deferido, o que provavelmente limita a exposição — mas "provavelmente"
não é veredito, e é por isso que precisa de investigação e não de suposição).
