---
"theokit": minor
"@theokit/presenter": minor
---

O piso de `@theokit/sdk` passa a ser o mesmo em todo o monorepo — `^4.40.0` (#183).

Três pacotes declaravam o mesmo requisito de três formas: `@theokit/agents` exigia `^4.40.0` como
dependência direta, `theokit` aceitava `^4.0.1` no peer, e `@theokit/presenter` aceitava `>=3.5.0` —
uma major inteira abaixo.

Um app que **honrasse o peer** e instalasse, digamos, `@theokit/sdk@4.5.0` satisfazia `theokit` e não
satisfazia o `agents`, então o resolvedor instalava uma **segunda cópia**. Duas cópias produzem dois
tipos nominalmente idênticos e estruturalmente incompatíveis, com a mensagem mais confusa do
ecossistema:

```
SandboxBackend is not assignable to SandboxBackend
```

Isso já custou uma sessão de debug a um consumidor.

**Nenhuma configuração que funciona hoje quebra.** Quem já está em `>= 4.40.0` não é afetado; quem
está abaixo já recebia a cópia dupla — a mudança troca uma falha confusa de tipo por um erro claro
de instalação. O que a declaração permitia e não funcionava, ela deixa de permitir.
