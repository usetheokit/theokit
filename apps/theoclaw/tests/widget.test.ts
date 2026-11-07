import { describe, expect, it } from 'vitest'

import { parseWidget, widgetTool } from '../src/canvas/widget.js'

type Handler = (input: unknown) => unknown
const run = (input: unknown): unknown => (widgetTool() as unknown as { handler: Handler }).handler(input)

describe('show_widget', () => {
  it('returns a table widget the page can parse back', () => {
    const output = run({ kind: 'table', title: 'T', columns: ['a', 'b'], rows: [['1', '2']] })
    expect(parseWidget(output)).toEqual({ kind: 'table', title: 'T', columns: ['a', 'b'], rows: [['1', '2']] })
  })
  it('refuses a row whose cells do not match the columns', () => {
    expect(() => run({ kind: 'table', columns: ['a'], rows: [['1', '2']] })).toThrow(/one cell per column/)
  })
  it('does not parse prose, other JSON or an unknown kind as a widget', () => {
    expect(parseWidget('hello')).toBeUndefined()
    expect(parseWidget('{"widget":{"kind":"html","body":"<script>"}}')).toBeUndefined()
    expect(parseWidget(undefined)).toBeUndefined()
  })
})
