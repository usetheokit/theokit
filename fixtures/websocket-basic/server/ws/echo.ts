import { websocket } from 'theokit/server'

export default websocket()
  .onOpen((ws) => {
    ws.send('connected')
  })
  .onMessage((ws, data) => {
    ws.send(`echo: ${data}`)
  })
  .build()
