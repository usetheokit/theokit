import type { Widget } from '../src/canvas/widget-schema.js'

/** One widget, drawn as plain elements: every string is a React text child, so none is parsed as HTML; the `html` kind is the one exception, a sandboxed iframe. */
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
    case 'html':
      return (
        <section data-widget="html">
          {title}
          <iframe
            title={widget.title ?? 'widget'}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">${widget.html}`}
            style={{ width: '100%', height: 240, border: '1px solid #8884' }}
          />
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
