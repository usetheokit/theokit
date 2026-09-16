import type { ReactElement } from 'react'

import { InkInputProvider, Stack } from '@theokit/tui'

import { ConversationRegion } from './components/index.js'
import { SessionFooter } from './components/index.js'
import { InputSlot } from './components/index.js'
import { ThemedSurface } from './theme/theme-session.js'
import { TerminalTitle } from './session-ui/title-session.js'
import { useTuiComposition } from './composition/use-tui-composition.js'

export function App(): ReactElement {
  const tui = useTuiComposition()
  return (
    // `ThemedSurface` rather than `<TheoTUIProvider theme={THEME}>`: the base is no longer a
    // constant, and the subscription that lets `/theme` repaint the running frame lives with the
    // provider it feeds (`theme-session.tsx`).
    <ThemedSurface>
      {/* Renders nothing and writes an OSC sequence when the facts behind the title change. OUTSIDE
          the `Stack`, deliberately: a `Stack` with `gap={1}` spaces its children, and a child that
          draws nothing would still be spaced — a blank line above the conversation, caused by a
          component with no visual output at all, is the kind of defect nobody thinks to look for. */}
      <TerminalTitle {...tui.titleProps} />
      {/* `InkInputProvider` bridges Ink's stdin to the interactive surfaces; `Stack` supplies the
          Claude Code cadence. */}
      <InkInputProvider>
        <Stack gap={1}>
          <ConversationRegion {...tui.conversationProps} />
          <InputSlot {...tui.slotProps} />
          <SessionFooter {...tui.footerProps} />
        </Stack>
      </InkInputProvider>
    </ThemedSurface>
  )
}
