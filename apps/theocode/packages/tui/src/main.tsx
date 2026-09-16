import { getTuiRoot } from './agent-session/index.js'
import { TUI_MAX_FPS } from './rendering/index.js'
import { drainAll, installStderrGuard, installTerminalTitle } from './terminal-io/index.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { render } from 'ink'

import { App } from './App.js'

import { setDiagnosticsSink } from '@theokit/agents'

import { installDiagnosticSink } from '@theocode/shared/diagnostic-sink'
import { setWorkingDirectory, workingDirectory } from './working-directory.js'
import { guardedSweepStart } from '@theocode/agent/session'
import { installConfiguredHome, resolveEffectiveConfig } from '@theocode/agent/config'

installDiagnosticSink(setDiagnosticsSink)

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile()
  } catch {
    // no .env on disk — rely on the ambient environment
  }
}

// B-057 — chosen ONCE, here, before anything reads it. The TUI has no directory flag yet, so this
// is the process directory today; when a `--cd` arrives it becomes a one-line change instead of
// twenty-three, and a second write throws rather than leaving trust and configuration describing
// different directories.
setWorkingDirectory(process.cwd())

// AFTER the working directory is set and BEFORE anything resolves an SDK path: this decides which
// directory the transcripts, the trust store and the collector all use, and it needs the cwd the
// operator selected rather than the one the process started in.
installConfiguredHome({
  env: process.env,
  home: homedir(),
  read: () => resolveEffectiveConfig({ cwd: workingDirectory() }),
  onWarn: (m) => process.stderr.write(`${m}\n`),
})

installStderrGuard(join(workingDirectory(), '.theokit', 'tui-stderr.log'))

// BEFORE the first frame, so the push captures the title the shell set rather than one of ours.
// The disposer is idempotent, which is why it can be both the normal shutdown step below and a
// backstop on `exit`: the ordinary path runs it after the queue drains, and the hook covers the
// paths that never reach that line — a throw out of the render, or a `process.exit` from anywhere.
const restoreTerminalTitle = installTerminalTitle()
process.once('exit', restoreTerminalTitle)

const instance = render(<App />, { exitOnCtrlC: false, maxFps: TUI_MAX_FPS })

// B-131 / B-132 / B-139 / B-142 — collection runs in a CHILD PROCESS, after the first frame.
//
// It used to run in this process behind a `void`, and that was measured as a 4.9-37.1 s freeze on
// the 13 269-project tree this repository cites: the sweep is synchronous JavaScript inside a
// dependency, so `void` deferred the tail of a function whose tail was empty. A child is the only
// mechanism that makes "housekeeping never delays a start" true rather than asserted.
//
// The whole call is wrapped, because `resolveEffectiveConfig` THROWS on a malformed `~/.theocode/
// config.toml` and it is evaluated while the argument object is built — before any promise exists,
// so a `.catch` could never have seen it. A typo in a config file must not take the terminal down
// after `render()` has already claimed it.
guardedSweepStart({
  // A function, not a value: `resolveEffectiveConfig` throws on a malformed config.toml and must be
  // read INSIDE the guard. See `guardedSweepStart`.
  enabled: () => resolveEffectiveConfig({ cwd: workingDirectory() }).session_gc,
  // stderr is redirected to `.theokit/tui-stderr.log` by `installStderrGuard` above (B-104), so this
  // is the diagnostics channel rather than a write over the Ink frame.
  onReport: (line) => {
    process.stderr.write(`${line}\n`)
  },
})

await instance.waitUntilExit()
await drainAll()
restoreTerminalTitle()

getTuiRoot().ptyOwner.shutdown()
