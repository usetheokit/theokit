/** Widgets (B-384, OC-61): a declarative spec the agent produces with `show_widget` and the WebChat page draws. Only the `html` kind carries markup, and the page runs it in a script-only sandboxed iframe. */

import { Tool, ToolError } from '@theokit/sdk'
import type { CustomTool } from '@theokit/sdk'
import { z } from 'zod'

import { MAX_ITEMS, text, widgetSchema } from './widget-schema.js'
export { parseWidget, widgetSchema } from './widget-schema.js'
export type { Widget } from './widget-schema.js'

export const WIDGET_TOOL_NAME = 'show_widget'

/** The tool's input: one flat object (the model API wants an object schema), checked against `widgetSchema` by the handler. */
const inputSchema = z.object({
  kind: z.enum(['text', 'list', 'table', 'metric', 'html']),
  title: text.optional(),
  body: z.string().max(5000).optional(),
  items: z.array(text).max(MAX_ITEMS).optional(),
  columns: z.array(text).max(20).optional(),
  rows: z.array(z.array(text).max(20)).max(MAX_ITEMS).optional(),
  html: z.string().max(20000).optional(),
  label: text.optional(),
  value: text.optional(),
})

/** `show_widget`: validates the spec and returns it as JSON for the page to draw. */
export function widgetTool(): CustomTool {
  const handler = (input: z.infer<typeof inputSchema>): string => {
    const parsed = widgetSchema.safeParse(input)
    if (!parsed.success)
      throw new ToolError(
        `show_widget: invalid ${input.kind} widget: ${parsed.error.issues[0]?.message ?? 'bad input'}`,
      )
    const widget = parsed.data
    if (
      widget.kind === 'table' &&
      widget.rows.some((row) => row.length !== widget.columns.length)
    ) {
      throw new ToolError('show_widget: every table row needs one cell per column')
    }
    return JSON.stringify({ widget })
  }
  return Tool.create({
    name: WIDGET_TOOL_NAME,
    description:
      'Show the owner a widget on the WebChat page. kind "text" (body), "list" (items), "table" (columns, rows of strings) "metric" (label, value) or "html" (html: a self-contained interactive page with inline script, shown in a sandboxed frame with no network or page access, e.g. a counter with a button); each takes an optional title.',
    inputSchema,
    handler,
  }) as unknown as CustomTool
}
