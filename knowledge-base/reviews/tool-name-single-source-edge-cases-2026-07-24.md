# Discover Edge Case Review — tool-name-single-source

Date: 2026-07-24
Discovery plan analyzed: `knowledge-base/discoveries/plans/tool-name-single-source-plan.md` (v1.0)
Research questions analyzed: 7
Edge cases found: 7 (MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: o plano já AFIRMA a resposta da Q4 na seção Context — viés de confirmação
- **Affected question:** Q4 (e, por herança, Q3)
- **Family:** Interpretation
- **Scenario:** a seção `## Context` afirma, com linha exata, que `validateToolName` tem 3 regras e que `mcp_*` é reservado. Durante `/discover-execute`, a Q4 pode ser "respondida" citando o próprio plano em vez de re-derivar do arquivo — o loop lê o Context (que está no contexto dele) e considera a questão fechada.
- **Impact:** o blueprint herda a sonda de pré-validação como se fosse investigação. Se a sonda estiver errada ou incompleta (ex.: existir uma quarta regra, ou o `RESERVED_TOOL_NAMES` variar por versão), o erro se propaga com aparência de evidência — a mesma falha que produziu o #145 (validar por amostragem).
- **Suggested fix:** marcar na Q4 que a afirmação do Context é **hipótese H1 a confirmar ou refutar**, e que a resposta deve enumerar as regras lendo `validateToolName` de ponta a ponta, declarando explicitamente se H1 foi CONFIRMADA ou REFUTADA.

### EC-2: citar linha de um bundle (`dist/index.js:6559`) apodrece no próximo bump do SDK
- **Affected question:** Q4, Q3, Q5
- **Family:** Citation
- **Scenario:** `node_modules/@theokit/sdk/dist/index.js` é artefato de build; os números de linha mudam a cada release, mesmo sem mudança de comportamento. Um revisor que conferir o blueprint depois de um `pnpm update` cai em linha errada e conclui que a citação é fabricada.
- **Impact:** citações verificáveis hoje viram ruído amanhã — corrói exatamente a propriedade que o hard cap de citação existe para proteger.
- **Suggested fix:** toda citação a `node_modules/` deve carregar **símbolo + versão instalada** (ex.: `@theokit/sdk@X.Y.Z › validateToolName`) além de arquivo:linha, e o blueprint deve registrar a versão lida uma vez no header.

### EC-3: um único peer clonado — o mínimo de ≥2 fontes independentes fica implícito
- **Affected question:** todas
- **Family:** Coverage
- **Scenario:** `cycle-discover.md § Anti-patterns` proíbe parar em uma fonte. Só `opencode` está em `knowledge-base/references/`; as outras duas fontes vivem em `node_modules/`. Sem declaração explícita, o blueprint pode fechar uma questão com uma fonte só e ninguém nota, porque o contador de "peers" parece 3.
- **Impact:** conclusão de desenho (ex.: "coagir vs lançar") apoiada em um único projeto, apresentada como consenso.
- **Suggested fix:** exigir, por questão, uma coluna `Fontes independentes` no blueprint; questão com uma fonte só é respondida mas marcada `SINGLE-SOURCE` explicitamente — nunca silenciosamente.

## SHOULD TEST

### EC-4: a permissão do opencode pode não ser chaveada pelo nome plano
- **Affected question:** Q6
- **Suggested halt-loop checkpoint:** antes de responder a Q6, confirmar se `Permission.evaluate(...)` / `Permission.visibleTools(...)` (`knowledge-base/references/opencode/packages/opencode/src/tool/registry.ts:263,283`) recebem a **chave plana namespaceada** ou um par estruturado. Se for par estruturado, a resposta da Q6 muda de forma — passa a ser "eles evitam o acoplamento não tendo chave", que é uma conclusão diferente (e mais forte) da esperada.

### EC-5: o knip pode estar configurado de um jeito que NUNCA reportaria o órfão
- **Affected question:** Q7
- **Suggested halt-loop checkpoint:** antes de concluir "o gate é cego", ler `knip.json` e verificar (a) se `packages/agents` está no `workspaces`, e (b) o comportamento de export de entrypoint — o knip, por padrão, **não** reporta exports não usados de arquivos de entrada (`includeEntryExports`). Se `compileHitlGates` é reexportado por `bridge/index.ts` (é: linha 9 lista `compileTools`; verificar se lista o `compileHitlGates`), a conclusão correta não é "knip falhou", e sim "knip está fazendo o que foi configurado para fazer" — e o M55 precisa saber a diferença antes de prometer `knip limpo` como gate.

## DOCUMENT

### EC-6: o `ai` instalado pode não ser a versão que o theokit alveja
- **Accepted risk:** o pacote entra como **contraponto de desenho** (nome como chave de tipo vs string validada), não como API a espelhar. Essa propriedade é estável há várias majors do Vercel AI SDK; um delta de patch/minor não muda a conclusão. Registrar a versão lida basta.

### EC-7: o clone do opencode é `--depth 1` de uma data desconhecida
- **Accepted risk:** as perguntas são sobre **intenção de desenho** (separador escolhido, coerção vs exceção, técnica de parse reverso), não sobre superfície de API versionada. Um snapshot responde igual. Mitigação barata já embutida: as citações são linha-exatas, então qualquer divergência futura é detectável em um `git log` do peer.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 1 (EC-3) | 0 | 0 |
| Q2 | 1 | 1 (EC-3) | 0 | 0 |
| Q3 | 2 | 2 (EC-1, EC-2) | 0 | 0 |
| Q4 | 2 | 2 (EC-1, EC-2) | 0 | 0 |
| Q5 | 1 | 1 (EC-2) | 0 | 0 |
| Q6 | 1 | 0 | 1 (EC-4) | 0 |
| Q7 | 1 | 0 | 1 (EC-5) | 0 |
| (transversal) | 2 | 0 | 0 | 2 (EC-6, EC-7) |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT — 3 MUST FIX a absorver antes de `/discover-execute`.
