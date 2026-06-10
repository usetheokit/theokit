/**
 * @Model() — override the LLM model at agent or tool level.
 *
 * Hierarchical resolution via Reflector.getAllAndOverride:
 *   tool @Model > agent @Model > @Agent({ model }) > config default
 *
 * This is a MODEL selector, not a PROVIDER selector. Provider routing
 * (which API key, which endpoint, fallback chains) lives in theo.config.ts
 * as runtime configuration — not in decorators.
 *
 * @example
 * ```ts
 * @Agent({ name: 'support', route: '/support' })
 * @Model('claude-sonnet-4-5-20250929')  // default for all tools
 * class SupportAgent {
 *   @MainLoop()
 *   async run() {}
 * }
 *
 * @Toolbox({ namespace: 'code' })
 * class CodeTools {
 *   @Tool({ name: 'generate', description: 'Generate code', input: z.object({...}) })
 *   @Model('claude-opus-4-6')  // this tool needs the most capable model
 *   async generate() { ... }
 *
 *   @Tool({ name: 'lint', description: 'Lint code', input: z.object({...}) })
 *   // no @Model — inherits from agent level
 *   async lint() { ... }
 * }
 * ```
 */
import { createDecorator } from '@theokit/http-decorators'

/** Override the LLM model for an agent class or a specific tool method. */
export const Model = createDecorator<string>()
