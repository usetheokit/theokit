---
'theokit': minor
---

M79 — o CLI sobe para a linha 4.x de `@theokit/agents`, colapsando as duas cópias.

O fonte já declarava `"@theokit/agents": "workspace:^"`; o pin `^0.44.6` existia apenas no pacote
publicado, porque o CLI não era republicado desde que `agents` foi para a linha 4.x. O skew de quatro
majors do mesmo pacote dentro de um processo era **atraso de publicação**, não acoplamento
arquitetural.

A razão registrada para não fazer isso estava obsoleta há vários milestones: um comentário no
consumidor afirmava que o CLI usava a free function `agent()` removida no M57, e por isso a segunda
cópia seria "inevitável". Ele não usa — zero chamadas no fonte, apenas uma menção em comentário.
`tests/unit/cli-agents-line.test.ts` é o oráculo que faltava, com contraprova para não valer por
vacuidade.

Acompanha `@theokit/agents@4.19.0`, onde os três `@theokit/sdk*` deixaram de ser `peerDependencies` e
viraram `dependencies` — peer permanece só para o genuinamente substituível (`zod`, `ai`,
`@theokit/http`).
