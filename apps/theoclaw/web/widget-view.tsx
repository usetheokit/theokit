import type { Widget } from '../src/canvas/widget-schema.js'

/** One widget, drawn as plain elements: every string is a React text child, so none is ever parsed as HTML. */
export function WidgetView({ widget }: { readonly widget: Widget }) {
  const title = widget.title === undefined ? null : <h3>{widget.title}</h3>
  switch (widget.kind) {
    case 'text':
      return (
        <section data-widget="text">
          {title}
          <p>{widget.body}</p>
        </section>
      )
    case 'list':
      return (
        <section data-widget="list">
          {title}
          <ul>
            {widget.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )
    case 'table':
      return (
        <section data-widget="table">
          {title}
          <table>
            <thead>
              <tr>
                {widget.columns.map((column, index) => (
                  <th key={index}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {widget.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )
    case 'metric':
      return (
        <section data-widget="metric">
          {title}
          <span>{widget.label}</span> <strong>{widget.value}</strong>
        </section>
      )
  }
}
