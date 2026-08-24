---
'theokit': minor
---

`theokit build` refuses a server-only module in the client bundle, and the error names both the
module and the file that imported it.

Three things are now server-only in the client graph: the `theokit/server` umbrella, every
`theokit/server/*` subpath the package publishes, and every module under the project's own
`serverDir` — except `actions/schemas/**`, which the `@theo/actions` facade deliberately bundles so
a form can validate against the same zod schema the server does.

The build already failed on these imports. It failed with `"resolve" is not exported by
"__vite-browser-external"`, pointing at a framework chunk, after thirty lines of externalisation
warnings — the bundler's difficulty rather than the author's mistake. It also failed by accident:
the cause was Node builtins not existing in a browser, so server code that imported none of them
would have bundled and shipped. And `theokit/server/define` failed differently again, with `ENOTDIR`
on a path built by string concatenation.

This is a build-time behaviour change: a project whose client graph reaches server code fails where
it may previously have built. That is the point of it, and the message says what to write instead.
