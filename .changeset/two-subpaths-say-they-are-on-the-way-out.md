---
"@theokit/http": minor
---

`@theokit/http/css-resource` and `@theokit/http/server-inserted-html` now carry `@deprecated`, so a
consumer's editor says what the package could previously only say in a document nobody opens.

Neither is removed. Under React 19 both are redundant — React hoists `<link rel="stylesheet"
precedence>` natively — but this package declares `react >=18.0.0`, and the React 18 half of that
range has no such hoisting. A published subpath with no measured importer is deprecated rather than
deleted, because absence of a measured importer is not absence of an importer.
