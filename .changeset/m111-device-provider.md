---
"@theokit/agents": minor
---

Autenticar por device flow passa a caber numa chamada, e um provider novo entra sem editar a camada.

Antes, quem usava `@theokit/agents/auth` para autenticar no Codex precisava saber que existem **duas**
formas de device flow, copiar o `clientId` e três URLs da OpenAI para dentro do próprio código, montar
`{ fetch, sleep, now }`, chamar `deviceLogin` e **lembrar** de chamar `persist` — e esquecer o último
custava um round-trip OAuth completo que não guardava nada.

Agora:

```ts
import { CODEX_PROVIDER, loginWithDevice } from '@theokit/agents/auth'

const [metodo] = CODEX_PROVIDER.methods            // rotulado, para a sua UI mostrar
const { path } = await loginWithDevice(CODEX_PROVIDER, metodo, store, { onPrompt })
```

Um provider de terceiro usa a **mesma** chamada: basta construir um `DeviceAuthProvider` com os seus
métodos. Nada na camada muda.

**Novos símbolos:** `CODEX_PROVIDER`, `loginWithDevice`, `CODEX_CLIENT_ID_ENV_VAR`, e os tipos
`AuthMethod`, `DeviceAuthProvider`, `PromptHooks`, `LoginWithDeviceOptions`.

`AuthMethod` é união discriminada — um método `type: 'oauth'` **tem** de carregar `authorize`, e o
compilador recusa `{ label, type: 'oauth' }`. Não há discriminante de protocolo: cada método aponta
para a sua própria função, então o RFC 8628 e a variante da OpenAI coexistem sem `switch` e sem risco
de serem fundidas.

`deps` é opcional; `AuthProvider.deviceLogin` e `.persist` continuam públicos para quem precisa da
granularidade. Nenhum símbolo existente mudou de assinatura.
