/**
 * @EditFormat() — declares how a tool outputs file edits.
 *
 * Code assistants show DIFFS, not entire files. This decorator tells the
 * runtime which format the tool produces so the SSE stream emits the
 * correct `file_edit` event type.
 *
 * @example
 * ```ts
 * @Toolbox({ namespace: 'editor' })
 * class EditorTools {
 *   @Tool({ name: 'edit', description: 'Edit file', input: editSchema })
 *   @EditFormat('search-replace')
 *   async edit(input: { file: string; search: string; replace: string }) {
 *     return { file: input.file, search: input.search, replace: input.replace }
 *   }
 *
 *   @Tool({ name: 'write', description: 'Write file', input: writeSchema })
 *   @EditFormat('full-file')
 *   async write(input: { file: string; content: string }) {
 *     return { file: input.file, content: input.content }
 *   }
 * }
 * ```
 */
import { createDecorator } from '@theokit/http'

export type EditFormatType =
  | 'search-replace'   // { file, search, replace } — Claude Code Edit pattern
  | 'unified-diff'     // Standard unified diff format
  | 'full-file'        // Complete file content (Write pattern)
  | 'line-range'       // { file, startLine, endLine, content }

/** Declare the edit format a tool produces. */
export const EditFormat = createDecorator<EditFormatType>()
