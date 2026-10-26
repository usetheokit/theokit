/**
 * The generation of each session key: `/new` and `/reset` move a key to its next generation, and
 * the agent id embeds it, so a reset is a new agent id with an empty history (plan D3). An unseen
 * key is at generation 0.
 */
export class Generations {
  readonly #counts = new Map<string, number>()

  current(key: string): number {
    return this.#counts.get(key) ?? 0
  }

  /** Move `key` to its next generation and return it. */
  async next(key: string): Promise<number> {
    const generation = this.current(key) + 1
    this.#counts.set(key, generation)
    return generation
  }
}
