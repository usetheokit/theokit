---
"theokit": patch
---

`theokit generate sandbox` writes a tool that asks for bubblewrap confinement through `createSandboxBackend({ mode: 'workspace-write' })` and checks `resolveSandboxPosture` before every command. Where bubblewrap is missing or cannot run, the tool throws `SandboxNotAvailableError` instead of running the command on the host; setting `THEOKIT_SANDBOX_ALLOW_UNCONFINED=1` opts into unconfined execution. The template used `LocalSandbox`, which the SDK documents as not an isolation boundary, while its tool description told the model the sandbox was isolated and its comment told the developer it was safe: a generated tool wrote into the app directory, read `/etc/passwd` and resolved DNS. The generated text now says what confinement covers and that the command can still read what the user can read. Files generated before this release keep the old code; regenerate them or switch them to `createSandboxBackend` by hand. (#1070)
