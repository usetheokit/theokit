import { defineConfig } from 'theokit'

export default defineConfig({
  // httpDecoratorsPlugin will be wired here when the TheoKit core
  // plugin system is extended to support decorator controllers.
  // For now, decorator routes are served via the onRequest hook
  // which intercepts before the file-based scanner.
})
