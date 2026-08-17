import { useLocation } from 'react-router'
import { Link } from 'theokit/client'

/**
 * The primary navigation menu. Add one entry per screen you add under `app/` (a screen is a folder with a
 * `page.tsx` — `app/settings/page.tsx` → `/settings`). Uses TheoKit's `Link` (react-router's Link + route
 * prefetch on hover/focus) and computes the active route from `useLocation`. See
 * `docs/ARCHITECTURE.md` § Adding a screen.
 */
const LINKS = [
  { to: '/', label: 'Chat', exact: true },
  { to: '/about', label: 'About', exact: false },
]

export function Nav() {
  const { pathname } = useLocation()
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map(({ to, label, exact }) => {
        const isActive = exact ? pathname === to : pathname.startsWith(to)
        return (
          <Link
            key={to}
            to={to}
            prefetch="intent"
            className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
              isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
