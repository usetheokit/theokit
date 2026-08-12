# T1 — Elevar o piso do `@theokit/sdk` para `^4.49.0`

**Data:** 2026-08-12 · **Plano:** `m67-layered-boundary-passthrough-plan.md` · **ADRs:** 0060, 0062

## RED

`packages/agents/tests/unit/sdk-floor.test.ts`, quatro testes. Execução inicial: **3 falharam, 1 passou.**

```
× test_every_package_declaring_the_sdk_pins_at_least_4_49   → 5 ranges abaixo do piso
× test_the_RESOLVED_sdk_satisfies_the_declared_floor         → 3 pacotes resolvendo abaixo
× test_the_workspace_resolves_exactly_one_sdk_copy           → ['4.40.0', '3.8.0']
```

O terceiro é o mais informativo: **provou empiricamente o ADR 0062**. O `@theokit/presenter`
declarava peer `^4.40.0` e dev `^3.8.0`, e a resolução confirmou que ele de fato **carregava 3.8.0** —
sua suíte verde estava exercitando uma major que não podia conter o que o peer prometia. Até este
teste, isso era argumento no ADR; virou medição.

## Dois defeitos corrigidos no próprio gate, durante o RED

Ambos da mesma classe do defeito que o milestone fecha — **um instrumento com escopo mais estreito do
que a propriedade que ele afirma**.

### 1. Contar diretórios do store não é contar cópias

A primeira versão de `test_the_workspace_resolves_exactly_one_sdk_copy` listava
`node_modules/.pnpm/@theokit+sdk@*` e exigia uma entrada. Resultado: **16 diretórios, 10 versões
distintas** (2.30.0, 3.8.0, 4.1.0, 4.27.0, 4.37.0, 4.38.0, 4.39.0/1/2, 4.40.0).

`pnpm why -r` mostrou o grafo **ativo** resolvendo 4.40.0 uniformemente. Ou seja: o `.pnpm` guarda um
diretório por permutação de peers **e** retém órfãos de instalações anteriores. A listagem responde
"o que já foi instalado alguma vez"; a pergunta certa é "o que o nosso código carrega".

Corrigido para resolver `@theokit/sdk/package.json` a partir do diretório de cada membro do
workspace, via `createRequire`. Mede o que é carregado, não o que sobrou no store.

### 2. A lista de manifests era fixa, e estava incompleta

A primeira versão listava três caminhos à mão — `packages/{agents,theo,presenter}` — e um teste-guarda
que varria `packages/*` para conferir a lista. Ele passou. E estava errado por omissão de escopo:

| Manifest | Declaração | Como escapou |
|---|---|---|
| `package.json` (raiz) | `devDependencies: ^4.40.0` | a raiz não está sob `packages/*` |
| `fixtures/template-default/package.json` | `dependencies: ^2.30.0` | fixture é membro do workspace, não `packages/*` |

Consequência medida **depois** do bump dos três pacotes:

```
.                    4.40.0     ← segunda cópia viva
packages/agents      4.51.1
packages/theo        4.51.1
packages/presenter   4.51.1
```

Os três pacotes passaram no gate enquanto a raiz do repositório carregava outra cópia. Corrigido:
`workspaceManifests()` agora **descobre** os membros a partir do `pnpm-workspace.yaml` mais a raiz, e
o teste-guarda ancora os dois casos que escaparam como regressão explícita.

A `fixtures/template-default` merece nota: pinava SDK major **2** enquanto linkava `theokit` e
`@theokit/agents` do workspace (7.4.2, cujo piso agora é 4.49). Não testava combinação real — é
apodrecimento, não intenção; nenhum script de sync a cobre e o template canônico nem declara o SDK.

## GREEN

Sete declarações movidas para `^4.49.0`, em cinco manifests:

| Manifest | Seção | De | Para |
|---|---|---|---|
| `package.json` | devDependencies | `^4.40.0` | `^4.49.0` |
| `packages/agents/package.json` | dependencies | `^4.40.0` | `^4.49.0` |
| `packages/theo/package.json` | devDependencies | `^4.40.0` | `^4.49.0` |
| `packages/theo/package.json` | peerDependencies | `^4.40.0` | `^4.49.0` |
| `packages/presenter/package.json` | devDependencies | `^3.8.0` | `^4.49.0` |
| `packages/presenter/package.json` | peerDependencies | `^4.40.0` | `^4.49.0` |
| `fixtures/template-default/package.json` | dependencies | `^2.30.0` | `^4.49.0` |

`pnpm install` resolveu **4.51.1** — o range `^4.49.0` admite, e o ADR 0060 registrou essa
consequência ao rejeitar a alternativa "subir para latest": o piso é o que a evidência sustenta, o teto
é o que o range permite.

## Achados classificados (EC-6 — classificação vai para o log, com evidência)

| Achado | Classificação | Ação |
|---|---|---|
| `@theokit/studio@0.1.0` com peers obsoletos: `@theokit/agents@^0.39.0` (workspace tem 7.4.2) e `@theokit/sdk@^3.8.0` | **Pré-existente para agents** (defasagem de 7 majors, já não batia); **superficiado pelo M67 para sdk** (a cópia 3.8.0 que o satisfazia era arrastada pelo presenter) | Peer OPCIONAL do `theokit`; install segue funcionando. Task própria aberta. Não bloqueia |
| 10 versões do SDK no `node_modules/.pnpm` | **Artefato de store**, não resolução ativa | Nenhuma. Documentado no teste para que ninguém volte a medir por listagem de diretório |
| Raiz e fixture declarando SDK antigo | **Defeito real de coerência**, encontrado pelo próprio gate | Corrigido neste T1 |
