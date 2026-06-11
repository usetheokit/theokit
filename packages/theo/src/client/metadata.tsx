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
 *         ogImage="/og/contacts.png"
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

export function Metadata(props: MetadataProps) {
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
