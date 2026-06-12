import { defineConfig } from 'theokit'
import { httpDecoratorsPlugin } from '@theokit/http/theokit-plugin'

export default defineConfig({
  port: 3000,
  plugins: [
    httpDecoratorsPlugin({
      controllersGlob: 'server/controllers/**/*.controller.ts',
    }),
  ],
})
