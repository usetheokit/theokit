---
'theokit': minor
---

Plugin lifecycle hooks now fire on a deployed app for the `cloudflare`, `bun` and `deno-deploy`
targets. They were dead on every Web-standards deployment while firing locally, so observability and
auth plugins were inert in production with nothing saying so.

A plugin declared by module specifier (`plugins: ['./src/plugins/audit.ts']`) is imported by a module
the build writes beside the entry. Those three targets bundle their output from the project, so the
static import reaches the app's own module; `vercel`, `netlify` and `aws-lambda` receive a standalone
function directory that never sees the app's source and keep declaring the concern unapplied.

A constructed plugin handed to a target that can carry a named one now fails the build, naming the
plugin and showing the specifier form. This is deliberate: it was previously dropped in silence.
