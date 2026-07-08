import { websocket } from 'theokit/server'

export default websocket()
  .onMessage((ws, data) => {
    ws.send(`notification: ${data}`)
  })
  .build()
