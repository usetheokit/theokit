import { config } from 'theokit'

export default config()
  .set({
    upload: {
      maxFileSize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    },
  })
  .build()
