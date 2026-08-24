/**
 * <Metadata> — SEO-ready head tags from a single component.
 *
 * Uses React 19's native <title>/<meta>/<link> hoisting to <head>.
 * No build-time extraction needed — works in SSR and client.
 *
 * @example
 * ```tsx
 * import { Metadata } from 'theokit/client'
 *
 * export default function ContactsPage() {
 *   return (
 *     <>
 *       <Metadata
 *         title="Contacts | My CRM"
 *         description="Manage your contacts"
 *         ogImage="https://mycrm.com/og/contacts.png"
 *         canonical="https://mycrm.com/contacts"
 *       />
 *       <h1>Contacts</h1>
 *     </>
 *   )
 * }
 * ```
 */

export interface MetadataProps {
  title?: string
  description?: string
  canonical?: string
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  ogType?: string
  ogUrl?: string
  twitterCard?: 'summary' | 'summary_large_image'
  /** Custom meta tags rendered as children */
  children?: React.ReactNode
}

/**
 * Absolute per RFC 3986, plus the protocol-relative form.
 *
 * A crawler handed `/og.png` resolves it against ITS origin, so the tag is present, well-formed and
 * useless. `//cdn.example.com/og.png` resolves against the page's scheme and is fine; a `data:` URI
 * carries its own bytes and has no origin to get wrong.
 */
function isAbsoluteUrl(value: string): boolean {
  return value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/iu.test(value)
}

/**
 * Refuse a relative `og:image` where refusing still helps — B-031.
 *
 * The Open Graph protocol requires an absolute URL, and a relative one fails only for people who are
 * not the author: it renders correctly in the browser and breaks in the crawler, so nobody learns
 * about it until the link has been shared, which is the one moment the card exists for.
 *
 * Development only, and the asymmetry is the design rather than a compromise. There is no build step
 * to refuse in — this component does its work at render time, which is why it needs no build-time
 * extraction at all — and throwing in production would turn a broken social card into a 500 on a
 * page that otherwise renders. That trades a defect for an outage. Throwing in development puts the
 * failure in front of the only person who can fix it, at the moment they wrote it, and costs a
 * production page nothing. Same `NODE_ENV` reading as `server/http/action-execute.ts`.
 */
function refuseRelativeOgImage(ogImage: string | undefined): void {
  if (ogImage === undefined || isAbsoluteUrl(ogImage)) return

  // `typeof` first, and not defensively. Every existing `process.env.NODE_ENV` reading in this
  // package is in SERVER code, where the global is always there. This is the first one in a client
  // module, and a bundler that does not substitute the value leaves `process` undefined in the
  // browser — turning a development-only warning into a `ReferenceError` at render, in production,
  // which is precisely the outage this check is shaped to avoid. Vite substitutes it and this
  // branch disappears; anything else falls through and the page renders.
  const env = typeof process === 'undefined' ? undefined : process.env.NODE_ENV
  if (env === undefined || env === 'production') return

  throw new Error(
    `<Metadata ogImage="${ogImage}"> must be an absolute URL. Open Graph resolves this value ` +
      `against the CRAWLER's origin, not your page's, so a relative path produces a tag that is ` +
      `present, well-formed and broken — and it looks correct locally.\n\n` +
      `  ogImage="https://your-domain.example/${ogImage.replace(/^\//u, '')}"\n\n` +
      `A protocol-relative URL (//cdn.example.com/...) and a data: URI are both accepted. This ` +
      `check runs in development only: production renders the value unchanged rather than failing ` +
      `the page.`,
  )
}

// Same rationale as `image.tsx`: React props are not mutated (agent-builder#319).
export function Metadata(props: Readonly<MetadataProps>) {
  refuseRelativeOgImage(props.ogImage)

  const ogTitle = props.ogTitle ?? props.title
  const ogDesc = props.ogDescription ?? props.description

  return (
    <>
      {props.title && <title>{props.title}</title>}
      {props.description && <meta name="description" content={props.description} />}
      {props.canonical && <link rel="canonical" href={props.canonical} />}
      {ogTitle && <meta property="og:title" content={ogTitle} />}
      {ogDesc && <meta property="og:description" content={ogDesc} />}
      {props.ogImage && <meta property="og:image" content={props.ogImage} />}
      {props.ogType && <meta property="og:type" content={props.ogType} />}
      {props.ogUrl && <meta property="og:url" content={props.ogUrl} />}
      {props.twitterCard && <meta name="twitter:card" content={props.twitterCard} />}
      {props.children}
    </>
  )
}
