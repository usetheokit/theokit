---
"@theokit/agents": patch
---

Testes do device provider endurecidos após review: o override de `clientId` por ambiente
(`CODEX_CLIENT_ID_ENV_VAR`) ganhou oráculo — antes era API pública documentada com zero teste, e
remover a leitura da variável mantinha tudo verde. Um teste que não invocava nenhum símbolo de
produção (passava com o pacote deletado) foi removido; a cobertura real do caso vive no consumidor.
Nenhuma mudança de comportamento.
