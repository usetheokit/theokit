import { TheokitAgentError } from '@theokit/sdk/errors'
/**
 * M91 — `Toolset`: coleção nomeada e imutável de tools, com política de resolução que falha alto.
 *
 * ## Por que na camada
 *
 * A camada já publica as costuras de `sandbox` e `interactive`; esta é a contraparte que faltava. Sem
 * ela, o consumidor escreveu a sua — `agents/tools/registry.ts` do agent-builder, 170 LoC — e a
 * política que importa (falhar alto em nome desconhecido **e** duplicado) ficou fora do framework,
 * onde o próximo consumidor teria de redescobri-la.
 *
 * ## O que ela NÃO faz, e por quê
 *
 * **Não prefixa namespace.** Foi isso que desqualificou o `ToolboxCapability` deste mesmo diretório
 * para este papel: o nome de uma tool é **contrato com o modelo**, e prefixar muda o que o modelo vê.
 *
 * **Não constrói tools.** Quais tools, com quais opções e sob qual escopo é decisão do consumidor —
 * a camada não sabe o `projectRoot` nem a postura de sandbox de ninguém. O `Toolset` recebe as
 * entradas já construídas e é dono só da **política de resolução**. É a divisão que impede a
 * primitiva de virar uma segunda cópia do registry do consumidor.
 *
 * ## Por que falhar alto nos dois casos
 *
 * Nome **desconhecido**: um role que declara `run_shell` numa whitelist e recebe silêncio fica sem a
 * tool sem ninguém notar. Nome **duplicado**: registra a mesma tool duas vezes no `Agent.create`, sem
 * sinal nenhum. Nos dois, o resultado é uma mudança de autoridade **não observável** — que é
 * exatamente o que uma whitelist existe para impedir.
 */

/** O mínimo que o `Toolset` precisa saber de uma tool: que ela tem nome. */
export interface ToolComNome {
  readonly name: string
}

/**
 * U-3 — inside the SDK hierarchy, not beside it.
 *
 * It extended `Error` directly, so `catch (e instanceof TheokitAgentError)` — how consumers tell an
 * SDK failure from any other throw — missed it, leaving name or message matching as the only way to
 * recognise it. A consumer reported having to write a translateError() shim for exactly that.
 *
 * This layer already settled the same argument in M61, when two `ConfigurationError` classes (one
 * `extends Error`, one `extends TheokitAgentError`) made an `instanceof` catch one path and silently
 * miss the other. Same defect, same package; it was simply left standing here.
 *
 * `code` stays a public readonly field rather than moving into the base options, so every existing
 * `new ToolsetError(msg, 'unknown_tool')` and every `err.code` read is unchanged.
 */
export class ToolsetError extends TheokitAgentError {
  override readonly name = 'ToolsetError'

  constructor(
    message: string,
    readonly code: 'unknown_tool' | 'duplicate_tool',
  ) {
    super(message)
  }
}

export class Toolset<T extends ToolComNome> {
  readonly #porNome: ReadonlyMap<string, T>

  private constructor(porNome: ReadonlyMap<string, T>) {
    this.#porNome = porNome
    Object.freeze(this)
  }

  /**
   * Constrói a partir das tools já instanciadas. Falha alto em nome duplicado **na construção** — não
   * na resolução: um descritor com duas tools de mesmo nome está errado no momento em que é escrito, e
   * adiar o erro para o primeiro `resolve` esconde metade dos casos.
   */
  static from<T extends ToolComNome>(tools: readonly T[]): Toolset<T> {
    const porNome = new Map<string, T>()
    for (const tool of tools) {
      if (porNome.has(tool.name)) {
        throw new ToolsetError(`duplicate tool "${tool.name}" in toolset`, 'duplicate_tool')
      }
      porNome.set(tool.name, tool)
    }
    return new Toolset(porNome)
  }

  /** Uma tool pelo nome. Lança com o nome no erro — nunca devolve `undefined` em silêncio. */
  get(name: string): T {
    const tool = this.#porNome.get(name)
    if (tool === undefined) {
      throw new ToolsetError(`unknown tool "${name}"`, 'unknown_tool')
    }
    return tool
  }

  /**
   * Resolve uma whitelist. Falha alto em desconhecido **e** em duplicado dentro da própria lista:
   * um time nunca concede em silêncio uma tool que o role não declarou, nem descarta em silêncio uma
   * que declarou.
   */
  resolve(names: readonly string[]): readonly T[] {
    const vistos = new Set<string>()
    return names.map((name) => {
      if (vistos.has(name)) {
        throw new ToolsetError(`duplicate tool "${name}" in a whitelist`, 'duplicate_tool')
      }
      vistos.add(name)
      return this.get(name)
    })
  }

  /** Os nomes conhecidos, na ordem de registro. */
  names(): readonly string[] {
    return [...this.#porNome.keys()]
  }

  /** Todas as tools, na ordem de registro. */
  all(): readonly T[] {
    return [...this.#porNome.values()]
  }
}
