---
'theokit': minor
---

`theokit` now depends on `vite@^7`. It pinned `vite@^6` while the default scaffold's
`@tailwindcss/vite@^4` pulls `vite@7`, so applications resolved two Vite majors and two `esbuild`
copies — two `postinstall` binary downloads for one framework. With one major in the tree, one of
each remains. An application using a Vite plugin built for v6 needs that plugin's v7 line.
