/**
 * <Link> — React Router Link with route prefetching.
 *
 * Wraps react-router's <Link> with prefetch behavior:
 *   - `intent` (default): prefetch on hover + focus (~200ms before click)
 *   - `viewport`: prefetch when visible (IntersectionObserver)
 *   - `none`: no prefetch (same as plain react-router Link)
 *
 * Uses `<link rel="prefetch">` (not modulepreload) because route paths
 * can be prefetched directly — no Vite manifest resolution needed (EC-1).
 */
import { useRef, useCallback, useEffect } from 'react'
import { Link as RouterLink, type LinkProps as RouterLinkProps } from 'react-router'

export type PrefetchBehavior = 'none' | 'intent' | 'viewport'

export interface LinkProps extends RouterLinkProps {
  /** Prefetch strategy. Default: 'intent' (on hover + focus). */
  prefetch?: PrefetchBehavior
}

/** Deduplication — each URL prefetched at most once per session. */
const prefetched = new Set<string>()

function injectPrefetch(href: string): void {
  // EC-2: SSR guard — document unavailable on server
  if (typeof document === 'undefined') return
  if (prefetched.has(href)) return
  prefetched.add(href)

  const link = document.createElement('link')
  link.rel = 'prefetch'
  link.href = href
  document.head.appendChild(link)
}

function resolveTo(to: LinkProps['to']): string {
  if (typeof to === 'string') return to
  return to.pathname ?? ''
}

/**
 * TheoKit Link — drop-in replacement for react-router Link with prefetch.
 *
 * @example
 * ```tsx
 * import { Link } from 'theokit/client'
 *
 * <Link to="/contacts">Contacts</Link>
 * <Link to="/dashboard" prefetch="viewport">Dashboard</Link>
 * <Link to="/settings" prefetch="none">Settings</Link>
 * ```
 */
export function Link({
  prefetch = 'intent',
  to,
  onMouseEnter,
  onFocus,
  ...rest
}: Readonly<LinkProps>) {
  const ref = useRef<HTMLAnchorElement>(null)

  const handleIntent = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement> | React.FocusEvent<HTMLAnchorElement>) => {
      if (prefetch === 'intent') {
        injectPrefetch(resolveTo(to))
      }
      // Forward original handlers
      if (event.type === 'mouseenter' && onMouseEnter) {
        onMouseEnter(event as React.MouseEvent<HTMLAnchorElement>)
      }
      if (event.type === 'focus' && onFocus) {
        onFocus(event as React.FocusEvent<HTMLAnchorElement>)
      }
    },
    [prefetch, to, onMouseEnter, onFocus],
  )

  // Viewport mode: IntersectionObserver
  useEffect(() => {
    if (prefetch !== 'viewport' || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') return // SSR guard

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          injectPrefetch(resolveTo(to))
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }, // prefetch slightly before visible
    )
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
    }
  }, [prefetch, to])

  return (
    <RouterLink ref={ref} to={to} onMouseEnter={handleIntent} onFocus={handleIntent} {...rest} />
  )
}
