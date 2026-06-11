/**
 * @Artifact() — marks a tool as producing structured output artifacts.
 *
 * Artifacts are SEPARATE from text responses. When a tool produces an artifact
 * (code file, document, diagram, JSON data), the SSE stream emits artifact_start
 * + artifact_chunk events alongside text_delta events.
 *
 * Inspired by assistant-ui's A2AArtifact pattern where artifacts have their own
 * lifecycle (start → chunks → complete) independent of message content.
 *
 * @example
 * ```ts
 * @Toolbox({ namespace: 'code' })
 * class CodeTools {
 *   @Tool({ name: 'generate', description: 'Generate code', input: z.object({...}) })
 *   @Artifact({ mimeType: 'text/typescript', streamable: true })
 *   async generate(input: { spec: string }): Promise<ArtifactResult> {
 *     return {
 *       content: generatedCode,
 *       filename: 'component.tsx',
 *       metadata: { language: 'typescript', loc: 42 },
 *     }
 *   }
 * }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const ARTIFACT_CONFIG = Symbol.for('theokit:agents:artifact')

export interface ArtifactOptions {
  /** MIME type of the artifact output. */
  mimeType: string
  /** Whether the artifact can be streamed in chunks (default: true). */
  streamable?: boolean
  /** Maximum size in bytes (0 = no limit). */
  maxSize?: number
}

/** Return type for tools decorated with @Artifact. */
export interface ArtifactResult {
  /** The artifact content (string for text, Buffer for binary). */
  content: string
  /** Optional filename hint for the client. */
  filename?: string
  /** Optional metadata attached to the artifact. */
  metadata?: Record<string, unknown>
}

export function Artifact(options: ArtifactOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const actualTarget = target.constructor
    setMeta(ARTIFACT_CONFIG, actualTarget, { streamable: true, maxSize: 0, ...options }, propertyKey)
  }
}

export function getArtifactConfig(
  target: Function,
  propertyKey: string | symbol,
): ArtifactOptions | undefined {
  return getMeta<ArtifactOptions>(ARTIFACT_CONFIG, target, propertyKey)
}
