# theoui-autoinject

Isolated fixture proving TheoUI auto-injection works **without any user-code import** of `@theokit/ui`.

## What this fixture exercises

When `@theokit/ui` is declared in `package.json` AND `ui` is enabled in `theo.config.ts`:

1. The Vite plugin emits `import '@theokit/ui/styles.css'` into the generated entry-client
2. Plus `import '@theokit/ui/fonts.css'` (or `fonts-cdn.css` based on config)
3. Plus the `<TheoUIProvider theme={{ defaultTheme: <theme> }}>` wrap around `<RouterProvider>`

The user's `app/page.tsx` doesn't have to touch `@theokit/ui`. That's the point — auto-injection.

## Config

```ts
defineConfig({
  ui: { theme: 'noir', fonts: 'cdn' },
})
```

## Conservative gate

Auto-injection requires `@theokit/ui` to be **declared** in `package.json` (deps / devDeps / peerDeps). Prevents monorepos from accidentally detecting the package at the workspace root.

## Run

```bash
npx vitest run tests/integration/fixture-theoui-autoinject.test.ts
```
