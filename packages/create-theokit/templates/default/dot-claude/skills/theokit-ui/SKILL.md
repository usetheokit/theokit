---
name: theokit-ui
description: "@theokit/ui component library — chat UI (ChatThread, ChatMessage, ChatComposer, CodeBlock), theming, providers, sidebar"
user-invocable: false
paths:
  - "app/**"
  - "**/*Chat*"
  - "**/*chat*"
  - "**/*Sidebar*"
  - "**/*sidebar*"
  - "**/*theme*"
  - "**/*Theme*"
---

# @theokit/ui — AI Chat Component Library

`@theokit/ui` is an optional peer dependency. If installed, it provides ready-made components for chat UIs, theming, and layout. **Never build custom equivalents** of components `@theokit/ui` provides.

## Package Identity

The published package is `@theokit/ui` (NOT `@usetheo/ui` — that was the old name).

```bash
# Install from npm (preferred)
npm install @theokit/ui

# Or from local tarball (when using source repo)
cd ../theo-ui && npm pack    # produces theokit-ui-X.Y.Z.tgz
cd ../my-app && npm install ../theo-ui/theokit-ui-X.Y.Z.tgz
```

**WARNING: NEVER use `npm link ../theo-ui` or `file:../theo-ui`.** The symlink exposes the sibling's nested `node_modules/react` (typically a different version), causing dual-React: "React Element from an older version" errors, broken hooks (`useState` null), and silent render failures. `resolve.dedupe` in Vite does NOT fix this — the pnpm structure physically has two React copies. Use tarball (`npm pack` → `npm install .tgz`) instead.

## Provider Setup (required before using any component)

```typescript
// app/layout.tsx
import '@theokit/ui/styles.css'
import { TheoUIProvider, ThemeProvider } from '@theokit/ui'

export default function Layout({ children }) {
  return (
    <TheoUIProvider>
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </TheoUIProvider>
  )
}
```

## Chat Components

### Full Chat Page (typical assembly)

```typescript
import {
  PageShell,
  Sidebar,
  SessionListItem,
  ChatThread,
  ChatMessage,
  ChatMessageContent,
  ChatComposer,
} from '@theokit/ui'
import { useAgentStream } from 'theokit/client'

function ChatPage() {
  const { status, events, send } = useAgentStream('/api/agents/assistant')

  return (
    <PageShell sidebar={
      <Sidebar>
        {sessions.map(s => (
          <SessionListItem key={s.id} title={s.title} onClick={() => select(s)} />
        ))}
      </Sidebar>
    }>
      <ChatThread>
        {messages.map(m => (
          <ChatMessage key={m.id} role={m.role}>
            <ChatMessageContent markdown={m.content} />
          </ChatMessage>
        ))}
      </ChatThread>

      <ChatComposer
        disabled={status === 'streaming'}
        onSubmit={text => send({ message: text })}
      />
    </PageShell>
  )
}
```

### Individual Components

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| `ChatThread` | Scrollable message container | `children` (ChatMessage elements) |
| `ChatMessage` | Single message bubble | `role: 'user' \| 'assistant'`, `children` |
| `ChatMessageContent` | Markdown + code rendering | `markdown: string` (handles streaming partial) |
| `CodeBlock` | Syntax-highlighted code | `code: string`, `language?: string` (uses shiki, lazy-loaded) |
| `ChatComposer` | Message input + submit | `onSubmit: (text) => void`, `disabled?: boolean` |
| `PageShell` | App layout with sidebar slot | `sidebar?: ReactNode`, `children` |
| `Sidebar` | Collapsible side panel | `children` |
| `SessionListItem` | Session entry in sidebar | `title: string`, `onClick`, `active?: boolean` |

### Other Useful Components

| Component | Purpose |
|-----------|---------|
| `Button`, `Input`, `Textarea` | Form primitives (themed) |
| `ToolCallCard` | Display agent tool invocations |
| `AgentStream` | Lower-level stream renderer |
| `ThemeSwitcher` | Light/dark mode toggle |
| `Avatar` | User/agent avatar |
| `Alert` | Status messages |

## Peer Dependencies (install only what you use)

**Chat/markdown path** (most apps need these):
```bash
npm install mdast-util-from-markdown mdast-util-to-hast mdast-util-gfm \
  hast-util-to-jsx-runtime hast-util-sanitize hast-util-from-html \
  micromark-extension-gfm unist-util-visit unist-util-visit-parents shiki
```

**DO NOT install** unless you use the specific components:
- `mermaid` — only for diagram rendering components
- `katex` — only for math/LaTeX rendering
- `roughjs` / `perfect-freehand` — only for whiteboard/drawing components

## Theming

```typescript
import { defineTheme, ThemeProvider } from '@theokit/ui'

// Built-in themes
import { dracula, oneDark, githubDark, anthropicStyle } from '@theokit/ui'

// Custom theme
const myTheme = defineTheme({
  name: 'my-theme',
  colors: { primary: '#3b82f6', background: '#0a0a0a' },
})

<ThemeProvider theme={myTheme}>
  {children}
</ThemeProvider>
```

## Anti-patterns

- NEVER build a custom chat message component — use `ChatMessage` + `ChatMessageContent`
- NEVER build a custom markdown renderer — `ChatMessageContent` handles it (including streaming partial fences)
- NEVER build a custom code highlighter — `CodeBlock` uses shiki (lazy-loaded)
- NEVER import from `@usetheo/ui` — that's the deprecated package name; use `@theokit/ui`
- NEVER use `npm link` or `file:../theo-ui` to install — causes dual-React (use tarball or npm registry)
- NEVER install ALL peer deps — only install the peers for components you actually use
- NEVER use components without wrapping in `TheoUIProvider` + `ThemeProvider` first
