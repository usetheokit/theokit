import { describe, expect, it } from 'vitest'

import { parseWidget, widgetTool } from '../src/canvas/widget.js'

type Handler = (input: unknown) => unknown
const run = (input: unknown): Promise<unknown> => (widgetTool() as unknown as { handler: Handler }).handler(input)

describe('show_widget', () => {
  it('returns a table widget the page can parse back', async () => {
    const output = await run({ kind: 'table', title: 'T', columns: ['a', 'b'], rows: [['1', '2']] })
    expect(parseWidget(output)).toEqual({ kind: 'table', title: 'T', columns: ['a', 'b'], rows: [['1', '2']] })
  })
  it('refuses a row whose cells do not match the columns', async () => {
    await expect(run({ kind: 'table', columns: ['a'], rows: [['1', '2']] })).rejects.toThrow()
  })
  it('refuses a widget missing its kind\'s field', async () => {
    await expect(run({ kind: 'list' })).rejects.toThrow()
  })
  it('does not parse prose, other JSON or an unknown kind as a widget', () => {
    expect(parseWidget('hello')).toBeUndefined()
    expect(parseWidget('{"widget":{"kind":"html","body":"<script>"}}')).toBeUndefined()
    expect(parseWidget(undefined)).toBeUndefined()
  })
})
