/**
 * How a repeated multipart field is represented, in one place.
 *
 * Two parsers reach this: the Web/Fetch one (`body-parser-web.ts`) and the
 * Node/Busboy one (`body-parser.ts`). Both used to do `fields[key] = value`,
 * so `tags=a&tags=b&tags=c` arrived as `'c'` — every value but the last was
 * gone before any consumer could see it (usetheokit/theokit#430).
 *
 * The representation lives here rather than in each parser because it is a
 * contract with the consumer, not an implementation detail of a transport. A
 * handler that receives `string[]` over HTTP/1 and `string` over the Web API
 * for the same form is a bug report nobody can reproduce.
 *
 * A field that occurs ONCE stays a plain string. That is not a nicety — every
 * existing consumer does `body.name.trim()`, and promoting a single value to a
 * one-element array would trade a data-loss bug for a breakage in every action
 * already shipped.
 */
export function appendField(
  fields: Record<string, string | string[]>,
  name: string,
  value: string,
): void {
  // `Object.hasOwn`, not `fields[name] === undefined`. A plain lookup walks the
  // prototype chain, so a field literally named `constructor` or `toString`
  // would find an inherited function and be treated as an existing value —
  // packing a function into what must only ever hold strings. The field name
  // comes off the wire, so that input is a caller's to choose.
  if (!Object.hasOwn(fields, name)) {
    fields[name] = value
    return
  }

  const prior = fields[name]
  if (Array.isArray(prior)) {
    prior.push(value)
  } else {
    fields[name] = [prior, value]
  }
}
