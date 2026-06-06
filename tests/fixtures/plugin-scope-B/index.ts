// Fixture plugin B — decorates `user` with value 'value-B' (SAME key as A).
// Post-T3.1: this co-exists with plugin A because each plugin gets its own
// child scope via `Object.create(parent)`. Pre-T3.1: TheoKit's
// DuplicateDecorationError protection (EC-7) rejects this — that's the
// RED state these tests prove will become GREEN once T3.1 ships.

import { defineTheoPlugin } from '../../../packages/theo/src/server/define/define-plugin.js'

export const pluginB = defineTheoPlugin({
  name: 'plugin-scope-B',
  register(app) {
    app.decorateRequest('user', 'value-B')
  },
})
