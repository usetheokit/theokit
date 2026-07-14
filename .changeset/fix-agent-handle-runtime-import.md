---
"theokit": patch
---

Fix `ReferenceError: agentHandle is not defined` in the browser when binding an agent by handle (`import { chat } from '@theo/agents'; useAgent(chat)`).

The generated runtime `@theo/agents` module re-exported `agentHandle` (`export { useAgent, agentHandle } from 'theokit/client'`) and then called it — but `export { x } from '…'` re-exports the name without creating a local binding, so `agentHandle('/api/agents/chat')` threw at module evaluation and the whole chat surface fell into the error boundary. `agentHandle` is now `import`ed (a local binding) and only `useAgent` is re-exported. Regression-guarded by a unit test over the extracted `generateAgentsRuntimeModule`, and verified end-to-end in a real browser (message → streamed agent reply). Shipped in `theokit@0.39.0` (M47); fixed here.
