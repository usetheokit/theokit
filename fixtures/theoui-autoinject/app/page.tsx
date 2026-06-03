/**
 * Bare page — does NOT import anything from @theokit/ui directly.
 * The Vite plugin still injects the styles + TheoUIProvider wrap into
 * the entry-client because `@theokit/ui` is declared in package.json
 * AND `ui` is enabled in theo.config.ts.
 */
export default function Page() {
  return (
    <main>
      <h1>TheoUI auto-inject demo</h1>
      <p>
        This page imports nothing from <code>@theokit/ui</code>. Yet the generated{' '}
        <code>/@theo/entry-client</code> emits the styles + Provider wrap automatically because the
        package is declared.
      </p>
    </main>
  )
}
