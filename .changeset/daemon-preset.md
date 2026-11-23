---
'create-theokit': minor
---

`--preset=daemon` scaffolds a long-running agent app on `@theokit/host`: an entry built on `createAppHost`, `defineInstanceConfig` with an `onboard` command, `daemon install|uninstall|status`, and a Dockerfile with a `/data` volume and a non-root user.
