import { ThemeSwitcher } from '@theokit/ui'
import { Bot } from 'lucide-react'

import { Nav } from './Nav'

/**
 * The app's top bar — product mark + the navigation menu + theme toggle. A layout component:
 * `app/layout.tsx` composes it above the routed page. Kept deliberately slim (a scaffold is an honest
 * starting point, not a demo dashboard — no fake cost meter, no dead buttons; every link goes to a real
 * route). Add real chrome here as you build (a conversation list, usage from the stream, …).
 */
export function Header() {
  return (
    <header className="flex items-center justify-between border-border/60 border-b px-4 py-2">
      <span className="inline-flex items-center gap-2">
        <Bot className="size-5 text-primary" aria-hidden />
        <span className="font-semibold text-sm tracking-tight">Theo Agent</span>
      </span>
      <div className="flex items-center gap-3">
        <Nav />
        <ThemeSwitcher />
      </div>
    </header>
  )
}
