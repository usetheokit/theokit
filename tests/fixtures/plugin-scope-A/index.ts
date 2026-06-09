// Fixture plugin A — decorates `user` with value 'value-A'.
// Used by tests/integration/plugin-scope-encapsulation.test.ts
// to assert that decoration in plugin A does NOT leak to plugin B
// nor to the parent app (post-T3.1 Object.create(parent) scope).

import { defineTheoPlugin } from '../../../packages/theo/src/server/define/define-plugin.js'

export const pluginA = defineTheoPlugin({
  name: 'plugin-scope-A',
  register(app) {
    app.decorateRequest('user', 'value-A')
  },
})
