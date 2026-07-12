import '@theokit/ui/styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'

/**
 * M47 — the desktop webview React entry. `@theokit/ui/styles.css` is the library's precompiled stylesheet
 * (no Tailwind toolchain in the desktop app), so `<ChatThread>`/`<ChatMessage>` render styled out of the box.
 */
const root = document.getElementById('root')
if (root === null) throw new Error('#root missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
