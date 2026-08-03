---
'@theokit/agents': minor
---

O device flow **RFC 8628** atravessa a camada, e o do Codex também.

`@theokit/sdk` já implementava o padrão (`deviceLogin`, `requestDeviceCode`, `pollDeviceToken`,
`DeviceOAuthConfig`), e `@theokit/agents/auth` não re-exportava nenhum deles. Como o consumidor tem
regra inquebrável de nunca importar `@theokit/sdk*` direto, quem precisasse do padrão tinha duas
saídas: violar a fronteira, ou reimplementar o protocolo — exatamente a situação que o M73 já
documentou neste arquivo (*"a lacuna era daqui, não indisciplina de lá"*).

Medido junto: `openaiDeviceLogin` era **importado** para uso interno do `AuthProvider` e nunca
re-exportado. Consequência — o flow do Codex só era alcançável construindo um `AuthProvider` (que
exige `config` + `store`). Ele atravessa agora também.

As duas formas **coexistem e não são unificadas**: `DeviceOAuthConfig` tem um `deviceCodeEndpoint`
(RFC); `OpenAIDeviceConfig` tem dois (`deviceUsercodeEndpoint` → `devicePollEndpoint`, com PKCE).
Fundi-las quebraria o Codex.

Pass-through **puro**, pelo critério que o M73 escreveu: são funções de I/O sem estado a segurar, e
envolver quebraria `instanceof`. `tests/unit/auth-parity.test.ts` trava a identidade dos quatro com
`toBe`.
