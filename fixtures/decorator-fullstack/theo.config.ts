import { defineConfig } from 'theokit'
import { httpDecoratorsPlugin } from '../../packages/http-decorators/src/theokit-plugin.js'

export default defineConfig({
  plugins: [
    httpDecoratorsPlugin({
      // Mode 1: Glob-based lazy loading via @swc/core.
      // Controllers are loaded on first request with full decorator metadata.
      // No esbuild parameter-decorator limitation.
      controllersGlob: 'server/controllers/**/*.controller.ts',
    }),
  ],
})
