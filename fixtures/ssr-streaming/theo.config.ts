import { config } from 'theokit'

export default config()
  .set({
    ssr: true,
    ssrStreaming: true,
  })
  .build()
