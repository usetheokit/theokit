/**
 * Mapeamento de erro do SDK → evento de erro do stream.
 *
 * Módulo próprio pela mesma razão de `model-selection.ts`: é um mapeador puro, e o
 * `sdk-adapter.ts` tem teto de 500 linhas. Ter home próprio também torna óbvio que existe **um**
 * lugar construindo o evento de erro — antes havia um objeto literal dentro de um `catch`, e era
 * ali que a informação morria.
 */
/**
 * Converte um erro do SDK no evento de erro do stream, **preservando o `code`**.
 *
 * Função própria e exportada porque este era o ponto onde a informação morria: o `catch` fixava
 * `code: 'SDK_ERROR'` e `retryable: false` para todo erro, e quem consome o stream ficava só com o
 * texto da mensagem para distinguir uma falha de outra — a heurística que este ecossistema já
 * pagou caro (o M93 classificava transitório por regex sobre a mensagem e tratava
 * `ECONNREFUSED …:443` como definitivo, porque a PORTA casava o padrão de "4xx").
 *
 * Exportada para que o teste exerça **esta** função, e não uma entrada montada à mão alimentada no
 * estágio seguinte do pipeline. Três testes deste milestone caíram nessa armadilha: construíam a
 * entrada da unidade em vez de exercer quem a produz, e por isso não pegaram o achatamento aqui.
 *
 * @internal
 */
export function sdkErrorEvent(err: unknown): {
  type: 'error'
  code: string
  message: string
  retryable: boolean
} {
  const sdkErr = err as { code?: string; isRetryable?: boolean }
  return {
    type: 'error',
    code: sdkErr.code ?? 'SDK_ERROR',
    message: err instanceof Error ? err.message : 'SDK agent error',
    // O SDK computa `isRetryable` por classe de erro na construção; fixá-lo em `false` aqui
    // contradizia o próprio erro.
    retryable: sdkErr.isRetryable === true,
  }
}
