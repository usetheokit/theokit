# OC-61 (canvas and widgets) verification

Built: the `show_widget` tool (`src/canvas/widget.ts`, a declarative text/list/table/metric spec, no HTML) in `buildTools`, and the WebChat renderer (`web/widget-view.tsx`, used by `web/chat-app.tsx`). Offline tests: `tests/widget.test.ts`, `tests/tool-registry.test.ts`.

Not verified: a widget produced by a real model rendering on the WebChat surface on a recorded run. This sandbox has no model credentials (and no installed dependencies), so the row stays open: only a person may declare it out, and it is not shipped. Not built: macOS-hosted widget panels.
