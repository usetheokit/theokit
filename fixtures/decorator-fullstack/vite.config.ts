import { defineConfig } from 'vite'
import swc from 'unplugin-swc'

/**
 * Vite config extension — adds SWC for decorator support.
 *
 * SWC handles experimentalDecorators + emitDecoratorMetadata natively,
 * which esbuild does NOT support. This enables clean @Body/@Param/@Query
 * parameter decorator syntax in controller files.
 *
 * In a production TheoKit app, this would be auto-configured by the
 * framework when @theokit/http-decorators is detected. For now, the
 * consumer adds this one plugin.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
})
