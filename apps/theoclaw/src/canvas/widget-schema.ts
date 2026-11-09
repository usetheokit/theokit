/** The widget spec and its parser: browser-safe (zod only), so the WebChat bundle can import it without the SDK's Node entry. */

import { z } from 'zod'

export const MAX_ITEMS = 50
export const text = z.string().max(500)

export const widgetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), title: text.optional(), body: z.string().min(1).max(5000) }),
  z.object({
    kind: z.literal('list'),
    title: text.optional(),
    items: z.array(text).min(1).max(MAX_ITEMS),
  }),
  z.object({
    kind: z.literal('table'),
    title: text.optional(),
    columns: z.array(text).min(1).max(20),
    rows: z.array(z.array(text).max(20)).max(MAX_ITEMS),
  }),
  z.object({ kind: z.literal('metric'), title: text.optional(), label: text, value: text }),
])

export type Widget = z.infer<typeof widgetSchema>

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
