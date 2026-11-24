# @theokit/host

Node-only utilities for long-running agent apps: a daemon, a personal assistant, a bot host. It holds the process-level pieces such an app needs (login service, config file, ordered start and stop, backups).

It contains no web code and no agent runtime code. Those live in `theokit` and `@theokit/agents`.

## `HostError`

Base class for every error `@theokit/host` throws.

```ts
import { HostError } from '@theokit/host'

try {
  throw new HostError('host_example', 'something failed', { cause: new Error('root') })
} catch (error) {
  if (error instanceof HostError) {
    console.log(error.code) // 'host_example': stable and machine-readable
    console.log(error.cause)
  }
}
```

## `defineInstanceConfig`

Declare an app's per-user config file (`@theokit/host/instance-config`) and get its path, load, write and audit.

```ts
import { defineInstanceConfig } from '@theokit/host/instance-config'
import { homedir } from 'node:os'

const config = defineInstanceConfig({
  app: 'my-agent',
  keys: {
    MY_AGENT_MODEL_KEY: { secret: true },
    MY_AGENT_PORT: { parse: (raw) => Number.parseInt(raw, 10) },
  },
})

config.path(process.env, homedir()) // $MY_AGENT_CONFIG, else $XDG_CONFIG_HOME or ~/.config/my-agent/my-agent.env
config.load(process.env, homedir()) // copies keys the environment does not hold; the environment wins
await config.write(config.path(process.env, homedir()), { MY_AGENT_PORT: '8080' }, { force: false })
config.fix(config.audit(config.path(process.env, homedir())))
```

`MY_AGENT_PROFILE=work` selects `my-agent-work.env`. A missing file named by `MY_AGENT_CONFIG` throws `InstanceConfigError`; a missing default file makes `load` return `undefined`. `write` creates the file 0600 and a directory it creates 0700, replaces atomically, refuses an existing file without `force`, refuses undeclared keys and values with `"`, `\` or a line break, and runs each key's `parse` first. Errors name keys and paths, never values. `audit` reports a file or app-owned directory open beyond its owner; `fix` applies `chmod` and returns the findings it fixed.

### `entryArgs` and `applyEntryArgs`

A Task Scheduler task carries no environment. Put `config.entryArgs()` (`--config <resolved path>`, plus `--profile <name>` when set; optional `env` and `homeDir`) in `ServiceSpec.args`, and call `config.applyEntryArgs(process.argv.slice(2), process.env)` before `load`. It sets the path and profile variables, accepts nothing else, and throws `InstanceConfigError` on an unknown, valueless or repeated flag, leaving `env` unchanged.

### `onboard`

First-run setup. Each declared key takes its value from `answers`, then from the environment variable named in `secretFromEnv` (an unset variable throws `InstanceConfigError` naming it), then from a prompt; a `secret: true` key is read with echo off. Values are checked with each key's `parse` and `validate` before anything is written; without `force` an existing file is refused by `write` itself. A key with `generate: () => string` always takes its value from `generate()`: it is never prompted for, and `answers` and `secretFromEnv` do not override it. Interactive use without a TTY throws `onboarding needs a terminal; pass the answers instead`.

```ts
// my-agent onboard [--yes] [--model m] [--api-key-env NAME] [--force]
const { path } = await config.onboard(
  { stdin: process.stdin, stdout: process.stdout, env: process.env, homeDir: os.homedir() },
  {
    interactive: !flags.yes,
    force: flags.force,
    answers: flags.model === undefined ? {} : { MODEL: flags.model },
    secretFromEnv: flags.apiKeyEnv === undefined ? {} : { API_KEY: flags.apiKeyEnv },
    prompts: { MODEL: { question: 'Model', default: 'claude-sonnet-5-5' } },
  },
)
```

**Hot reload.** `config.watch(path, env, { debounceMs?, validate?, onEvent })` watches the file's directory (so an editor's rename-over is seen), debounces 250 ms by default, and returns `{ close() }`; the watcher and timer are unref'd. A changed key declared `hot` is applied to `env` unless the caller set that variable; every other changed key is listed in `restartRequired`. A file whose hot key fails its `parse`, or that `validate(candidate)` refuses by throwing, gives `refused` and keeps the running values. A watcher error closes the watcher and reports `{ kind: 'watch-failed', cause }`. Events (`applied`, `unchanged`, `refused`, `watch-failed`) name keys, never values. `config.reload(path, env, previous)` is the single step and returns `{ result, accepted }`. Pair it with `restartSelf`:

```ts
config.watch(path, process.env, {
  onEvent: (event) => {
    if (event.kind === 'applied' && event.restartRequired.length > 0) void restartSelf({ startEnv: originalEnv })
  },
})
```

## `@theokit/host/service`

Install an agent app as a login service and restart it through its supervisor. Linux (`systemd --user`), macOS (launchd LaunchAgent) and Windows (Task Scheduler) exist today; `serviceBackend` throws `UnsupportedPlatformError` for any other platform.

```ts
import { serviceBackend, isSupervised, restartSelf, waitForPredecessor } from '@theokit/host/service'

const backend = serviceBackend() // linux -> systemd
await backend.install({
  label: 'my-agent',
  command: '/usr/bin/node',
  args: ['/srv/my-agent/dist/main.js'],
  env: { MY_AGENT_CONFIG: '/home/me/.config/my-agent.json' },
  workingDirectory: '/srv/my-agent',
}) // writes ~/.config/systemd/user/my-agent.service, then daemon-reload, enable --now, restart
console.log(await backend.status('my-agent')) // 'running' | 'stopped' | 'not-installed' | 'unknown'
```

- `install` writes the unit atomically. If a `systemctl` step fails it throws `ServiceCommandError` (with `command` and `exitCode`), puts the previous unit back (or removes the file on a first install) and runs `daemon-reload`.
- A value the unit cannot hold (a line break, a bad label) throws `ServiceDefinitionError` naming the field, never the value. `%` is doubled everywhere and `$` in `ExecStart=`, per systemd.syntax(7).
- macOS: `serviceBackend('darwin', { uid: process.getuid(), logFile })` writes `~/Library/LaunchAgents/<label>.plist` and runs `launchctl bootout` (a missing service is no error) then `launchctl bootstrap gui/<uid>`. `install` without `uid` throws `ServiceDefinitionError`. stdout and stderr go to `logFile`, default `~/Library/Logs/<label>.log`. A failing `bootstrap` removes the plist and throws `ServiceCommandError`. `KeepAlive` restarts the agent only after a non-zero exit, so `restartSelf` (exit code 75) restarts it and a clean stop stays stopped. `uninstall` keeps the plist when `bootout` fails and `launchctl print` does not say the service is absent (exit 113). `restart` runs `launchctl kickstart -k gui/<uid>/<label>`. `launchdPlist(spec, { logFile })` returns the XML-escaped plist text.
- The unit stops at logout unless lingering is on: run `loginctl enable-linger <user>` to keep it running.

### Windows (Task Scheduler)

`serviceBackend('win32')` registers a logon-triggered scheduled task named by `label` (least privilege, no time limit, restart after failure every minute) from a UTF-16 XML file kept in a fresh private temporary directory and removed afterwards. `scheduledTaskXml(spec, { user })` returns the definition.

- **A task carries no environment.** `install` with a non-empty `spec.env` throws `ServiceDefinitionError`: pass the values as `args` instead. Every argument is quoted per the `CommandLineToArgvW` rules.
- The task runs as `USERDOMAIN\USERNAME` from `options.env`; without `USERNAME`, `install` throws `ServiceDefinitionError`. `command` and `workingDirectory` must be Windows absolute paths.
- A failing `/Create` or `/Run` deletes the task and throws `ServiceCommandError`.
- State is read through `Get-ScheduledTask` (`schtasks` output is localised). `uninstall` stops the task's process tree, then deletes the task; a failed `/Delete` counts as success only when PowerShell confirms the task is absent. `definitionPath` returns the task name.

Restart from inside the app:

```ts
await waitForPredecessor(process.env) // first thing in a successor: waits for the old pid to exit
// later, when a setting that needs a restart changes:
const next = await restartSelf({ startEnv: originalEnv })
if (next.kind === 'exit') process.exit(next.code) // 75: the supervisor starts the app again
```

`isSupervised` is true for `INVOCATION_ID` on Linux and for `XPC_SERVICE_NAME` other than `0` on macOS. Otherwise `restartSelf` spawns a detached successor (it gets `THEOKIT_HOST_RESTART_AFTER_PID`) and resolves with its pid. `restartSelf` is asynchronous because Node reports a failed spawn through the child's `error` event after `spawn` returns: it rejects with a `RestartError` whose `cause` is that actual error (or the error `spawn` threw). On a platform other than Linux or macOS it rejects with `UnsupportedPlatformError`.

## `@theokit/host/backup`

Back up and restore named directories of an agent app. Needs `@theokit/sdk` (peer) for the atomic manifest write; SQLite databases need Node 22.16 or later.

```ts
import { backup, restore, BackupError } from '@theokit/host/backup'

const roots = { state: '/srv/app/state', workspace: '/srv/app/workspace' } // names: [a-z0-9-]+, absolute paths

await backup({
  roots,
  out: '/srv/backups/2026-11-19', // must be absent or empty, and not overlap a root
  exclude: (root, relativePath) => root === 'state' && relativePath === 'import', // e.g. credentials
  lock: async () => {
    const release = await takeMyLock()
    return async () => release() // acquired before the first read, released after success or failure
  },
})

await restore({ from: '/srv/backups/2026-11-19', roots })
```

- Restoring to a different project path: pass `transform: rehomeTranscripts({ root: 'state', projectsDir: '.app/projects', from: oldPath, to: newPath })` so the SDK's `projects/<encoded path>/` transcripts move under the new path's name and sessions resume there. Name the root and the `projects` directory your app uses.
- Each root is copied to `<out>/<name>`; `manifest.json` (path, sha256, size per file) is written last, atomically. Directories are 0700 and files 0600.
- A symbolic link in a root makes `backup` reject with a `BackupError` naming it. A failed backup removes its output.
- A root that is itself a symbolic link is rejected too. Backups are portable between POSIX systems; a file name holding a backslash (legal on POSIX only) cannot be restored on Windows, where `restore` refuses it.
- SQLite files (found by header) are snapshotted with the `node:sqlite` backup API, without their `-wal`, `-shm` and `-journal` files.
- `restore` checks every file against the manifest before writing, refuses manifest paths that leave their root, stages each root beside its target, checks the bytes again, then renames into place. An existing target is kept aside and put back if a later root fails to place.
- `restore({ ..., transform })` maps each archived path (relative to its root, `/`-separated, with the root name as the second argument) to the path written below that root's target, e.g. to re-key a directory that encodes an absolute path. A result that is empty, absolute, holds `..` or a backslash, or that two files share, rejects before anything is written.
- The lock protects cooperating writers only; the renames of several roots are not crash-atomic.

### Storage locations

Keep backups in named places, optionally encrypted at rest with AES-256-GCM.

```ts
import { createStorageRegistry } from '@theokit/host/backup'

const storage = createStorageRegistry({ file: '/srv/app/config/storage.json', defaultRoot: '/srv/app/backups' })
await storage.init('offsite', { root: '/mnt/shared/backups', encrypted: true }) // names: [A-Za-z0-9][A-Za-z0-9_-]{0,63}
const archive = await storage.store('offsite', '/srv/backups/2026-11-19') // verifies the manifest first
await storage.fetchLatest('offsite', '/srv/restore-from') // into must be absent or empty; then `restore`
await storage.test('offsite') // writes, reads back, decrypts and removes a probe
```

- **The key lives in the registry file** (`file`, mode 0600, written atomically) as base64, next to the location it belongs to. Lose that file and an encrypted archive cannot be opened; copy it somewhere safe. No error or returned value holds it.
- An encrypted entry with no valid key makes `store`, `fetchLatest` and `test` fail with `BackupError`; plaintext is never used instead.
- An archive is one file (`backup-<time>-<id>.tcbk`, 0600): `TCBK`, a version byte, a mode byte, then a length-prefixed stream of directories and files, read and written through streams so memory does not grow with the backup. A wrong key, a changed byte or a foreign file rejects with `BackupError`.
- `fetchLatest` unpacks into a private staging directory beside `into`, checks the manifest, then renames it into place; on any failure nothing is left behind. Entries that are absolute, hold `..` or a backslash, or are repeated are refused.
- `test` reports `sizeBytes` (the archives held) and `freeBytes` when the file system tells.
- **Earlier TheoClaw data.** A registry written as a flat `{ "<name>": { root, encrypted, key } }` (hex key) is read as is and rewritten in the current format at the next `init`. `fetchLatest` and `test` also read local `backup-<time>.tcb` archives (base64 JSON, `TCBK1` encryption), and pick the newest archive across both formats; `store` always writes `.tcbk`.
- **Timeout.** A remote request is abandoned after 60 s of silence (`createStorageRegistry({ ..., timeoutMs })`), body included.
- **Manifest-last directory transfer.** `uploadDirectory(dir, url, { token, timeoutMs })` and `downloadDirectory(dir, url, ...)` move a backup directory file by file to an HTTPS object directory, the manifest last, with no listing endpoint (`If-None-Match: *`, redirects refused, each request bounded by `timeoutMs`, default 60 s).
- **HTTPS location.** `init('cloud', { root: 'https://host/dir', encrypted, token })` stores archives on a server instead of a directory (`createStorageRegistry({ ..., ca })` adds trusted PEM authorities for a private server). `token` is sent as `Authorization: Bearer` and kept in the registry file only; `list` and errors omit it. The server holds objects at `<url>/<name>`: `PUT` with `If-None-Match: *` (answer 412 for an existing name), `GET`, and `GET <url>/` returning `{"names": [...]}`. `store` uploads `backup-….tcbk` first and `backup-….tcbk.manifest.json` (the manifest) last; only an archive with that marker is a backup, so an interrupted upload is never fetched. `test` checks the listing only (`sizeBytes` is 0).
- Registry updates are not locked across processes.

## `createAppHost` (`@theokit/host/app-host`)

Starts an app's services in order, stops them in reverse, and does it once however the app ends: a failed start, `close()` or SIGINT/SIGTERM.

```ts
import { createAppHost } from '@theokit/host/app-host'

const host = createAppHost({
  signals: process,
  exit: (code) => process.exit(code),
  onError: (step, error) => console.error(step, error),
  stopTimeoutMs: 10_000,
})
const store = host.service('store', () => openStore(), (s) => s.close())
const server = host.service('server', () => listen(store()), (s) => s.close())
await host.start() // a failure stops the started services in reverse, then rejects with AppHostStartError
// later: const result = await host.close() // { ok: true } or { ok: false, failed, timedOut }
```

- `service(name, start, stop?)` registers a service; start order is registration order. The returned getter gives the started value and throws before the service has started. Registering after `start()` throws.
- `start()` rejects with `AppHostStartError` (`step`, `cause`, `rollbackFailures`). Calling it twice returns the same promise.
- `close()` stops the started services in reverse, once; later calls return the same promise. A stop that throws is reported through `onError` and the remaining stops still run. One watchdog (`stopTimeoutMs`) covers the whole teardown; stops still pending then are listed in `timedOut` and not run. A `close()` during `start()` waits for the start to settle and stops what started.
- With `signals`, the first SIGINT or SIGTERM runs `close()`, then `exit(0)`, or `exit(1)` if a step failed or timed out. A second signal goes to `onError` and is ignored. Listeners are removed when the teardown ends.

Use `createAppHost` for a supervised service (systemd, a container), where a clean stop exits 0. For a terminal session (Ctrl-C, exit code 130) keep using `createShutdown` from `@theokit/agents/commands`. `@theokit/host` does not import `@theokit/agents`.

## `applyOutboundProxy` and `validateProxy`

```ts
import { applyOutboundProxy, validateProxy } from '@theokit/host'

const { installed } = applyOutboundProxy(process.env, { variable: 'APP_PROXY' })
const check = await validateProxy(process.env.APP_PROXY!, { target: 'api.openai.com:443', timeoutMs: 5000 })
if (!check.ok) console.error(check.reason, check.message) // 'connect_refused' | 'timeout' | 'connection_error' | 'invalid_proxy_url'
```

- `applyOutboundProxy` installs an undici `ProxyAgent` as the **process-wide** global dispatcher when the variable is set, so every `fetch` in the process goes through the proxy. With it unset or blank nothing is installed (`installed: false`).
- `validateProxy` sends a CONNECT for `target` (`host:port`) to an `http:` or `https:` proxy and returns `{ ok: true, statusCode }` or a typed failure. `timeoutMs` defaults to 5000. Credentials in the URL are sent as basic auth and never appear in messages.

## `teeOutput`

`teeOutput({ file, maxBytes, keep, streams? })` mirrors this process's stdout and stderr (or `streams`) into a 0600 file that never grows past `maxBytes`, keeping `keep` rotated files (`file.1` newest). It returns an uninstall function that restores the streams. It throws if the file cannot be opened.

## `announceService` (`@theokit/host/discovery`)

Announces a running service on the local network (DNS-SD) through a publisher you inject; the package has no multicast dependency.

```ts
import { announceService } from '@theokit/host/discovery'

const announcement = announceService({ type: 'myagent', name: 'My agent', port: 8080, txt: { path: '/api' }, host, publisher })
// announcement.announced is false (reason 'loopback') when host is loopback
await announcement.stop()
```

- `publisher` is `{ publish({ name, type, port, txt }), unpublishAll(): Promise<void>, destroy(): Promise<void>, onError?(listener): () => void }`. `@theokit/host/discovery-bonjour` exports `createBonjourPublisher({ onError?, interface?, ip? })`, an adapter over `bonjour-service`, an optional peer dependency pinned to `1.4.4`. It reports socket, answer-path, send and name-conflict errors as `DiscoveryError` instead of letting the library exit the process.
- `onError` (optional) is called once, after the announcement has stopped, for the first error a publisher with `onError` reports after `publish`. You create it, so a loopback `host` avoids using it but not building it.
- A loopback `host` (`localhost`, `::1`, `127.0.0.0/8`) announces nothing; the result has `announced: false` and `reason: 'loopback'`.
- `name` is trimmed to 63 UTF-8 bytes (RFC 6763) on a character boundary; the result's `name` is what was published.
- `stop()` calls `unpublishAll` then `destroy`, each waited for at most one second, so it resolves within about two seconds even if the publisher never answers. It is idempotent and never rejects.

## License

Apache-2.0

## Browser (`@theokit/host/browser`)

`browserMcpServer(options)` returns a stdio MCP server config for a Playwright MCP browser an agent can drive (`browser_navigate`, `browser_snapshot`, ...). The server runs behind a filtering proxy:

- `browser_run_code_unsafe` (it runs model-written JavaScript in the server process) is **always** left out of `tools/list` and refused on `tools/call`; `deny: ['tool', ...]` adds more tools.
- The server's working directory and `--output-dir` are `outputDir`, an absolute directory you own (its contents stay after exit). Without it, a fresh temporary directory is used and removed on exit. The `roots` capability and `PLAYWRIGHT_MCP_*` variables are stripped so neither widens the file root.
- Page snapshots are inlined into tool results; JSON-RPC batches are refused; calls run one at a time.

```ts
import { browserMcpServer, createSharedBrowser } from '@theokit/host/browser'

// A fresh headless Chromium per session.
const isolated = browserMcpServer({ mode: 'isolated', outputDir: '/var/app/browser-out' })

// One persistent Chromium shared by many sessions; each session works in a tab of its own.
const shared = createSharedBrowser('/var/app/browser-profile')
const cdpEndpoint = await shared.start()
const attached = browserMcpServer({ mode: 'shared', cdpEndpoint })
// ... when the app stops:
await shared.close()
```

It needs a Chromium headless shell (`npx playwright-core install chromium-headless-shell`). This is Playwright's output-directory control plus a proxy, not an operating-system sandbox: tools such as `browser_evaluate` still run page-side JavaScript and the browser reaches the network.
