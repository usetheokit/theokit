/**
 * @Mixin() — compose reusable capability classes into an agent.
 *
 * Mixins are classes with @Tool methods that can be shared across agents.
 * @Mixin copies tool metadata from mixin classes to the decorated agent,
 * making those tools available without inheritance.
 *
 * @example
 * ```ts
 * // Define reusable capabilities
 * class WithSearchCapability {
 *   @Tool({ name: 'web_search', description: 'Search', input: z.object({...}) })
 *   async webSearch(input) { ... }
 * }
 *
 * class WithFileSystem {
 *   @Tool({ name: 'read_file', description: 'Read', input: z.object({...}) })
 *   async readFile(input) { ... }
 * }
 *
 * // Compose into agent
 * @Agent({ name: 'research', route: '/research' })
 * @Mixin(WithSearchCapability, WithFileSystem)
 * class ResearchAgent {
 *   @MainLoop()
 *   async run() {}
 * }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const MIXIN_CLASSES = Symbol.for('theokit:agents:mixins')

export function Mixin(...mixinClasses: Function[]): ClassDecorator {
  return (target: Function) => {
    const existing = getMeta<Function[]>(MIXIN_CLASSES, target) ?? []
    setMeta(MIXIN_CLASSES, target, [...existing, ...mixinClasses])
  }
}

export function getMixins(target: Function): Function[] {
  return getMeta<Function[]>(MIXIN_CLASSES, target) ?? []
}
