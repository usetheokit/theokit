/** Widgets (B-384, OC-61): a declarative spec the agent produces with `show_widget` and the WebChat page draws. No HTML or script ever travels in one. */

import { Tool, ToolError } from '@theokit/sdk'
import type { CustomTool } from '@theokit/sdk'
import { z } from 'zod'

const MAX_ITEMS = 50
const text = z.string().max(500)

export const widgetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), title: text.optional(), body: z.string().min(1).max(5000) }),
  z.object({ kind: z.literal('list'), title: text.optional(), items: z.array(text).min(1).max(MAX_ITEMS) }),
  z.object({
    kind: z.literal('table'),
    title: text.optional(),
    columns: z.array(text).min(1).max(20),
    rows: z.array(z.array(text).max(20)).max(MAX_ITEMS),
  }),
  z.object({ kind: z.literal('metric'), title: text.optional(), label: text, value: text }),
])

export type Widget = z.infer<typeof widgetSchema>

export const WIDGET_TOOL_NAME = 'show_widget'

/** `show_widget`: validates the spec and returns it as JSON for the page to draw. */
export function widgetTool(): CustomTool {
  return Tool.create({
    name: WIDGET_TOOL_NAME,
    description:
      'Show the owner a widget on the WebChat page. kind "text" (body), "list" (items), "table" (columns, rows of strings) or "metric" (label, value); each takes an optional title.',
    inputSchema: widgetSchema,
    handler: (input) => {
      if (input.kind === 'table' && input.rows.some((row) => row.length !== input.columns.length)) {
        throw new ToolError('show_widget: every table row needs one cell per column')
      }
      return JSON.stringify({ widget: input })
    },
  }) as unknown as CustomTool
}

/** The widget a tool result holds, or `undefined` when it is not a valid one. */
export function parseWidget(output: unknown): Widget | undefined {
  let value: unknown = output
  if (typeof output === 'string') {
    try {
      value = JSON.parse(output)
    } catch {
      return undefined
    }
  }
  if (value === null || typeof value !== 'object' || !('widget' in value)) return undefined
  const parsed = widgetSchema.safeParse((value as { widget: unknown }).widget)
  return parsed.success ? parsed.data : undefined
}
