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

/** The tool's input: one flat object (the model API wants an object schema), checked against `widgetSchema` by the handler. */
const inputSchema = z.object({
  kind: z.enum(['text', 'list', 'table', 'metric']),
  title: text.optional(),
  body: z.string().max(5000).optional(),
  items: z.array(text).max(MAX_ITEMS).optional(),
  columns: z.array(text).max(20).optional(),
  rows: z.array(z.array(text).max(20)).max(MAX_ITEMS).optional(),
  label: text.optional(),
  value: text.optional(),
})

/** `show_widget`: validates the spec and returns it as JSON for the page to draw. */
export function widgetTool(): CustomTool {
  const handler = (input: z.infer<typeof inputSchema>): string => {
    const parsed = widgetSchema.safeParse(input)
    if (!parsed.success) throw new ToolError(`show_widget: invalid ${input.kind} widget: ${parsed.error.issues[0]?.message ?? 'bad input'}`)
    const widget = parsed.data
    if (widget.kind === 'table' && widget.rows.some((row) => row.length !== widget.columns.length)) {
      throw new ToolError('show_widget: every table row needs one cell per column')
    }
    return JSON.stringify({ widget })
  }
  return Tool.create({
    name: WIDGET_TOOL_NAME,
    description:
      'Show the owner a widget on the WebChat page. kind "text" (body), "list" (items), "table" (columns, rows of strings) or "metric" (label, value); each takes an optional title.',
    inputSchema,
    handler,
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
