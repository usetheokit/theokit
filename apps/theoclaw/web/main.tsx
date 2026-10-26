import '@theokit/ui/components.css'

import { createRoot } from 'react-dom/client'

import { ChatApp } from './chat-app.js'

const root = document.getElementById('root')
if (root === null) throw new Error('the WebChat page has no #root element to mount on')
createRoot(root).render(<ChatApp />)
