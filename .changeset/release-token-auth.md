---
"theokit": patch
"create-theokit": patch
---

`publishConfig.provenance` sai dos pacotes: ele nunca produziu attestation e impedia o publish
manual (#169).

O npm recusa attestation de provenance para repositório-fonte **privado** (E422), e este repo é
privado. Medido: nenhuma versão publicada de nenhum pacote daqui tem `dist.attestations` não-nulo —
o campo era aspiracional desde o primeiro release.

O custo não era só cosmético. `provenance: true` no `publishConfig` vence a flag `--no-provenance` e
a variável `npm_config_provenance`, então com o CI quebrado o `theokit` ficou **sem via de release
nenhuma**: nem automática, nem manual.

Quando o repo for público, o campo volta junto com `NPM_CONFIG_PROVENANCE` e os trusted publishers.
