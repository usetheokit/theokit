# @theokit/agents-pty

The PTY interactive backend for [`@theokit/agents`](https://www.npmjs.com/package/@theokit/agents).

```bash
npm install @theokit/agents-pty
```

```ts
import { PtyInteractiveBackend } from '@theokit/agents-pty'
```

## Why it is a separate install

`@theokit/sdk-pty` carries a native install step — it downloads a prebuild, or falls back to
compiling C++. While it was a hard dependency of `@theokit/agents`, **every application paid that
cost**, including the web apps that never open a terminal: installing `@theokit/agents` alone took
6.7 s with it and 1.4 s without, and in a scaffolded app that was most of the gap in time to first
green run.

So it moved here. An application that drives a terminal declares this package; one that does not
never compiles it. See [usetheokit/theokit#460](https://github.com/usetheokit/theokit/issues/460).

## Migrating from `@theokit/agents/pty`

The subpath is gone. Install this package and change the import — the surface is identical, six
symbols, unchanged:

```diff
-import { PtyInteractiveBackend } from '@theokit/agents/pty'
+import { PtyInteractiveBackend } from '@theokit/agents-pty'
```

Nothing else changes. The `@theokit/sdk-pty` surface is re-exported whole, not wrapped (the owner
below is an addition), which is also why you should not import `@theokit/sdk-pty` directly: an application takes its primitives from
the `@theokit/*` layer, and this package is that layer for the PTY backend.

## Owning the backend per session

The sandbox wrap is fixed when a process starts, so a shell launched under `danger-full-access`
stays unconfined after the user switches to `read-only`. `createPtyOwner` keeps one backend per
session and follows the mode: tightening kills every live PTY and builds a new backend; loosening
keeps them. A new command is always wrapped with the current mode.

```ts
import { createPtyOwner } from '@theokit/agents-pty'
import { interactiveWrapCommand } from '@theokit/agents/sandbox'

const owner = createPtyOwner({
  mode: 'workspace-write',
  maxSessions: 16,
  wrapFor: (mode) => interactiveWrapCommand({ mode }),
})

owner.backend() // hand this to the app's interactive tools
owner.setMode('read-only') // => { killed: n }
owner.rotate() // e.g. /new: kill and rebuild
owner.shutdown() // kill on exit
```

`order` (most confined first) defaults to `read-only`, `workspace-write`, `danger-full-access`.
`maxSessions < 1` or a mode outside `order` throws `PtyOwnerConfigError` (`code: 'pty_owner_invalid'`).

## Licence

Apache-2.0
