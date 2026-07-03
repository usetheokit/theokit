# ui-message-stream-skeleton

M0 walking skeleton for the `theokit-ai-first` initiative: a theokit agent's
**text** stream reaches `@ai-sdk/react`'s `useChat` with **no custom adapter**.

## The chain

```
agent AgentStreamEvent stream (from @theokit/sdk Run.stream via the bridge)
  → translateToUIMessageStream(events, { textId })   @theokit/agents
  → uiMessageStreamResponse(chunks)                  theokit/server
  → Response on the UIMessageStream wire (x-vercel-ai-ui-message-stream: v1)
  → useChat parses it directly                       @ai-sdk/react
```

## Files

- `server/routes/chat.ts` — a **manually-wired** endpoint (NOT the `server/agents/`
  convention, which is M2). It composes the two M0 primitives by hand and returns
  a `Response`. Swap the deterministic `echoAgentStream` for your agent's bridged
  SDK stream — nothing else changes.
- `app/page.tsx` — `useChat({ api: '/api/chat' })`. No theokit-specific client
  code between the hook and the stream. That is the M0 proof.

## Scope

Text only. Tool / reasoning / file parts land in M1. The deterministic proof of
this chain lives in `packages/agents/tests/integration/ui-message-stream-e2e.test.ts`
(round-trips agent text through the real ai-sdk consumer transport, no live LLM).
