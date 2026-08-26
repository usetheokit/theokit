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
        `<main>` SCROLLS. The shell pins itself to the viewport (`h-screen`), so the document never
        scrolls and something inside has to — and the default is here, where an ordinary page gets
        it for free. It used to be `overflow-hidden`, which is right for the chat and wrong for
        every other page: content below the fold was simply unreachable, with nothing to explain it
        (usetheokit/theokit#484). A page with the unusual requirement declares it; the common one
        should not have to.

        `min-h-0` is the non-obvious half. This is a grid child, and a grid/flex child defaults to
        `min-height: auto` — it refuses to shrink below its content, so `overflow-y-auto` alone does
        nothing at all. Whatever you scroll, it needs both.

        `data-theo-scroll` marks this as a scroll container, so its offset is restored on back
        navigation (usetheokit/theokit#421). Browsers and react-router only ever restore the
        DOCUMENT, which here never scrolls, so without the marker there is nothing to restore. The
        value is the id — add the attribute to any other element you scroll, with a different value.
      */}
      <main data-theo-scroll="main" className="min-h-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
