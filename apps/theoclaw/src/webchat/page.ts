/** The WebChat page: an HTML shell that loads the bundle `build:web` writes, and where that bundle is. */

/** The assets `build:web` writes, served by name and nothing else (no URL path reaches the file system). */
export const WEBCHAT_ASSETS = {
  'app.js': 'text/javascript; charset=utf-8',
  'app.css': 'text/css; charset=utf-8',
} as const

/**
 * Where `build:web` writes the bundle: `apps/theoclaw/dist/web/assets/`, the same directory from
 * `src/webchat/` under tsx and from `dist/webchat/` once compiled (EC-5).
 */
export const WEBCHAT_ASSETS_DIR = new URL('../../dist/web/assets/', import.meta.url)

/** The page's shell. `main.tsx` mounts the app on `#root` (EC-10). */
export function renderPage(): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>TheoClaw</title>',
    '<link rel="stylesheet" href="/webchat/assets/app.css">',
    '</head>',
    '<body>',
    '<div id="root"></div>',
    '<script type="module" src="/webchat/assets/app.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
