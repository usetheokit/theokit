# @theokit/tauri

Ship your TheoKit agent as a desktop app. One call wires the Tauri shell to your agent — you write the UI, not the bridge.

A [Tauri](https://tauri.app) app is a Rust shell around a system webview. `@theokit/tauri` connects the two halves to a TheoKit agent:

- **In the webview** — your agent streams into React with the same `useAgent` hook you already use on the web, rendered with [`@theokit/ui`](https://www.npmjs.com/package/@theokit/ui).
- **In the Node sidecar** — one helper runs a turn and streams it out as newline-delimited JSON for the Rust shell to forward.

Framework core (`theokit`) never learns about Tauri — the Tauri primitives are handed in, so this package is an opt-in add-on, not a dependency of the framework.

## Install

```sh
npm add @theokit/tauri
```

`theokit` is a peer dependency; `@tauri-apps/api` is an **optional** peer (only needed in the webview half).

## Webview — drive the UI with `useAgent`

```ts
import { Channel, invoke } from '@tauri-apps/api/core'
import { ChannelTransport } from 'theokit/client'
import { createTauriChannelSource } from '@theokit/tauri'

const transport = new ChannelTransport({
  source: createTauriChannelSource({ invoke, Channel }),
})

// then, in a component:
const agent = useAgent(transport)
```

No React? `createTauriAgentClient({ invoke, Channel })` returns the same handle over the standalone client.

The Rust side exposes two commands (names configurable via `{ runCommand, approveCommand }`, default `run_turn` / `approve`) that talk to the sidecar.

## Node sidecar — stream one turn as JSONL

```ts
import { runTurnToJsonl } from '@theokit/tauri/sidecar'
import * as chatAgent from './agents/chat.js'

await runTurnToJsonl(chatAgent, process.env.OPENROUTER_API_KEY!, message, (line) => process.stdout.write(line))
```

Each line is one `UIMessageChunk`; a failed turn ends with a `{"type":"error"}` line — errors are surfaced, never swallowed.

## Scaffold it

`npm create theokit@latest my-app -- --surface desktop` generates a complete Tauri app already wired to this package.

## License

Apache-2.0
