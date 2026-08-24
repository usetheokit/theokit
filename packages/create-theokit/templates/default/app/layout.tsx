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
      {/*
        `data-theo-scroll` marks this as a scroll container, so its offset is restored on back
        navigation (usetheokit/theokit#421). Browsers and react-router only ever restore the
        DOCUMENT; in a shell like this one the document never scrolls, so without the marker there
        is nothing to restore. The value is the id — add the attribute to any other element you
        scroll, with a different value.
      */}
      <main data-theo-scroll="main" className="flex h-full flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
