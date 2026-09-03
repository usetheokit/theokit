/**
 * The line `--tailwind` prepends to the app's stylesheet.
 *
 * A constant with a test rather than a string literal inside `applyOptions`, for the reason the
 * literal was wrong: it was written `@import "tailwindcss";` with a blank line after it, while the
 * template's `.prettierrc` sets `singleQuote: true`. The generated project runs `format:check` over
 * its own tree, so a user's first commit failed the gate on a line they never typed — and no test
 * could see it, because `applyOptions` writes to disk and the check that exists reads the TEMPLATE,
 * which never contains this line.
 *
 * Kept here so `tailwind-css-import.test.ts` can hand it to Prettier and ask.
 */
export const TAILWIND_CSS_IMPORT = `@import 'tailwindcss';\n`
