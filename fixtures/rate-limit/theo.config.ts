import { config } from 'theokit'

export default config()
  .set({
    rateLimit: {
      windowMs: 10_000, // 10 second window
      max: 5, // 5 requests per window per client
    },
  })
  .build()
