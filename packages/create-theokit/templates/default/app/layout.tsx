import '@theokit/ui/styles.css'

import { Outlet } from 'react-router'
import { ThemeSwitcher } from '@theokit/ui'
import { Bot } from 'lucide-react'

/**
 * App shell — a slim top bar (product name + theme toggle) over the chat surface.
 *
 * Deliberately minimal: everything shown WORKS. A scaffold is an honest starting point, not a demo
 * dashboard — so there is no fake cost meter, no fake token counter, and no dead History/Settings buttons.
 * Add real chrome (a conversation list, usage from the stream, a settings route) as you build it.
 */
export default function RootLayout() {
  return (
    <div className="grid h-screen w-screen grid-rows-[auto_1fr] bg-background text-foreground">
      <header className="flex items-center justify-between border-border/60 border-b px-4 py-2">
        <span className="inline-flex items-center gap-2">
          <Bot className="size-5 text-primary" aria-hidden />
          <span className="font-semibold text-sm tracking-tight">Theo Agent</span>
        </span>
        <ThemeSwitcher />
      </header>

      <main className="flex h-full flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
