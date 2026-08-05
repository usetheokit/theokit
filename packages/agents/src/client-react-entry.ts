/**
 * M84 — `@theokit/agents/client/react`: o hook, separado do resto da cadeia.
 *
 * A separação não é estética. `@theokit/agents/client` é **livre de React por contrato** para que um
 * consumidor Node — um transporte in-process num processo sem UI — não arraste React no grafo só por
 * importar um transporte. Juntar os dois numa entrada só fez exatamente isso, e o gate herdado do CLI
 * (`test_client_core_entry_imports_no_react`) reprovou na primeira execução.
 *
 * `react` é peer **opcional** do pacote: quem nunca importa esta entrada não precisa tê-lo instalado;
 * quem importa já tem, porque um hook só roda dentro de um componente.
 */
export { useAgent } from './client/use-agent.js'
export type { UseAgentReturn, UseAgentOptions, UseAgentStatus } from './client/use-agent.js'
