import { Link, Metadata } from 'theokit/client'

/**
 * An EXAMPLE second route — you're looking at `app/about/page.tsx`, served at `/about`. It exists to show
 * how the app grows past one screen (and how the `Nav` menu links between them). Delete this folder when
 * you don't need it — nothing else depends on it.
 *
 * It also demonstrates two TheoKit client primitives: `<Metadata>` (sets the `<title>` / meta tags for
 * this route via React 19 head hoisting) and `<Link>` (react-router's Link + route prefetch).
 */
export default function AboutPage() {
  return (
    <>
      <Metadata
        title="About · TheoKit agent"
        description="How screens are added to a TheoKit app."
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
        <h1 className="font-semibold text-xl tracking-tight">Adding screens</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          This is the <code>/about</code> route — the file <code>app/about/page.tsx</code>. Routing
          is file-based: a screen is a folder under <code>app/</code> with a <code>page.tsx</code>.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-sm">
          <li>
            <code>app/settings/page.tsx</code> → <code>/settings</code>
          </li>
          <li>
            <code>app/users/[id]/page.tsx</code> → <code>/users/:id</code> (dynamic)
          </li>
          <li>
            scaffold one with <code>theokit generate page &lt;name&gt;</code>
          </li>
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The navigation menu lives in <code>app/components/Nav.tsx</code> — add a link there per
          screen. See <code>docs/ARCHITECTURE.md</code> § Adding a screen. Delete this page when you
          don't need it.
        </p>
        <Link to="/" prefetch="intent" className="text-primary text-sm hover:underline">
          ← Back to the chat
        </Link>
      </div>
    </>
  )
}
