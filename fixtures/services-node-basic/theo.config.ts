import { config } from 'theokit'

export default config()
  .set({
    port: 3000,
    services: {
      worker: {
        runtime: 'node',
        port: 8102,
        proxy: '/api/worker',
        dev: 'pnpm dev',
        start: 'pnpm start',
        healthcheck: '/health',
      },
    },
  })
  .build()
