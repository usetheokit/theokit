# Deps Audit — m67-layered-boundary-passthrough

Date: 2026-08-12
Mode: plan-bound (`.claude/knowledge-base/plans/m67-layered-boundary-passthrough-plan.md` § Dependencies)
Ecosystem: npm (pnpm workspace)

## Dependências declaradas pelo plano

O plano declara exatamente **uma** mudança de dependência. Nenhum pacote é adicionado ou removido.

| Pacote | Range atual | Range alvo | Tipo de mudança |
|---|---|---|---|
| `@theokit/sdk` | `^4.40.0` (agents dep, theo dev+peer) / `^3.8.0` (presenter dev) | `^4.49.0` | Piso elevado dentro do mesmo major |

## Vulnerabilidades — a dependência do plano

| Fonte | Consulta | Resultado |
|---|---|---|
| OSV (`api.osv.dev/v1/query`) | `@theokit/sdk@4.49.0` | `{}` — nenhum advisory |
| OSV | `@theokit/sdk@4.40.0` (baseline) | `{}` — nenhum advisory |
| `pnpm audit --prod --audit-level=high` | árvore inteira | 4 high / 5 moderate / 2 low — **nenhum em `@theokit/sdk`** |

**Verdito para a dependência do plano: PASS.** Zero CVE conhecido em qualquer das duas versões, e o
movimento é de piso dentro do mesmo major.

Vale registrar o inverso do risco habitual: **permanecer em 4.40.0 é a posição menos segura**. O
CHANGELOG publicado de 4.41.1 e 4.42.1 descreve duas correções de containment — imports de contexto
`@path` escapando do repositório em que são declarados, e uma checagem que admitia diretório irmão e
qualquer symlink. Não são CVEs registrados, mas são correções de segurança que só chegam com o bump.

## Vulnerabilidades — pré-existentes na árvore (fora do escopo deste plano)

Encontradas pela auditoria e registradas aqui porque um achado objetivo com evidência não pode ser
engolido. **Nenhuma delas é dependência declarada deste plano; nenhuma bloqueia o M67.**

| Sev | Pacote | Vulnerável | Corrigido em | Título |
|---|---|---|---|---|
| high | `nanoid` | `<3.3.16` | `>=3.3.16` | geradores não-seguros podem entrar em loop infinito com tamanho negativo |
| high | `nanoid` | `<3.3.17` | `>=3.3.17` | geradores customizados podem entrar em loop infinito |
| high | `postcss` | `<=8.5.17` | `>=8.5.18` | path traversal no auto-loading de source map anterior |
| high | `react-router` | `>=7.12.0 <7.18.2` | `>=7.18.2` | bypass de CSRF em modo RSC permite execução de action |

**Cadeia de origem:** `nanoid` e `postcss` entram por `vitest@3.2.6 → vite@6.4.3 → postcss → nanoid`,
via `@theokit/sdk-tools@0.26.1` — ou seja, toolchain de teste, 74 caminhos. `react-router` é
dependência de aplicação.

**Por que não bloqueiam o M67:** a `deps-audit-golden-rule` § 2 pontua CVE em **dependência declarada
pelo plano**. Estas são transitivas pré-existentes, presentes antes e depois da mudança, e nenhuma é
alcançada pelo diff do milestone. Arrastá-las para dentro do M67 seria scope creep; ignorá-las seria
pior. Ficam registradas com dono próprio (ver abaixo).

**Ação:** aberto item de trabalho separado para tratá-las — bump de `vitest`/`vite` (que resolve
`postcss` e `nanoid` de uma vez) e de `react-router`. O `react-router` é o mais urgente dos quatro:
bypass de CSRF é exploração remota, enquanto os dois `nanoid` e o `postcss` estão em toolchain de
build/teste, não em caminho servido em produção.

## Versões desatualizadas (fora do piso)

`@theokit/sdk` latest publicado é `4.51.1`; o plano fixa o piso em `^4.49.0` (que resolve 4.51.1 de
qualquer forma). O ADR-0051 registra a alternativa "subir para latest" e por que foi rejeitada: o
piso é o que a evidência sustenta, e subir além disso é escolha sem critério.

## Rule 9 — não reinventar

A alternativa a este bump seria reimplementar os oito símbolos localmente. Rejeitada no ADR-0051 e
reafirmada aqui: `resolveTrustPosture` e `applySecurityFloor` são política de segurança do runtime, e
uma segunda implementação diverge silenciosamente da primeira. Nenhuma dependência nova é introduzida
para evitar escrever código — a que existe apenas sobe de piso.

## Verdict

**PASS.**

- Nenhum CVE em `@theokit/sdk`, nem na versão atual nem na alvo.
- Nenhuma dependência nova; nenhuma superfície de supply-chain adicionada.
- 4 advisories `high` pré-existentes na árvore, todos fora do escopo declarado do plano, registrados
  com ação própria em vez de silenciados.
