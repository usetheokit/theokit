import '@theokit/ui/styles.css'

import { Outlet } from 'react-router'

import { Header } from './components/Header'

/**
 * App shell (the root layout) — composes the `Header` above the routed page. Deliberately minimal:
 * everything shown WORKS. A scaffold is an honest starting point, not a demo dashboard — so there is no
 * fake cost meter, no fake token counter, and no dead History/Settings buttons. Grow the chrome by editing
 * `components/Header.tsx` (or adding more layout components) as you build.
 */
export default function RootLayout() {
  return (
    <div className="grid h-screen w-screen grid-rows-[auto_1fr] bg-background text-foreground">
      <Header />
      <main className="flex h-full flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
