import { homedir } from 'node:os'
import process from 'node:process'

import { installAuthHome } from '@theocode/agent/auth'
import { installConfiguredHome, resolveEffectiveConfig } from '@theocode/agent/config'
import { installClaudeProjectDir } from '@theocode/agent/hooks'
import { createShutdown } from '@theokit/agents/commands'
import { loadProjectEnv, gitGate, parseExecArgs, USAGE } from './runtime/index.js'
import type { ExecArgs, ExecHelp, ExecUsageError, ExecVersion } from './runtime/index.js'
import { AGENT } from '@theocode/shared/agent'
import { goalCommand } from './commands/goal.js'
import { reviewCommand } from './commands/review.js'
import { runCommand } from './commands/run.js'
import { sessionsCommand } from './commands/sessions.js'
import { doctorCommand } from './commands/doctor.js'
import { migrateConfigCommand } from './commands/migrate-config.js'
import { setDiagnosticsSink } from '@theokit/agents'
import { installDiagnosticSink } from '@theocode/shared/diagnostic-sink'

installDiagnosticSink(setDiagnosticsSink)

/**
 * B-026 — the bootstrap runs INSIDE main, after `chdir`, and not between import declarations.
 *
 * `loadProjectEnv()` and `ensureAuthHome()` used to sit between the imports above, which reads as
 * ordered setup and is not: ESM hoists every import declaration and evaluates all of them before
 * the first statement runs. So every command module was loaded before the project `.env` existed in
 * `process.env`, and any module-level read of it saw the pre-bootstrap state.
 *
 * The second half is user-visible (B-023): `process.loadEnvFile()` reads `.env` from the CWD AT
 * CALL TIME, and `-C/--cd` chdir'd inside `main` — after this had already run. `theocode -C other/
 * …` therefore loaded the `.env` of the directory the user was leaving.
 */
function bootstrap(): void {
  loadProjectEnv()
  // `installAuthHome`, not `ensureAuthHome`: this line has to WRITE the variable, and for a while
  // it did not. B-034 stopped `ensureAuthHome` mutating its argument and this call site — whose
  // whole purpose is the mutation — kept calling it and threw the answer away. The CLI therefore
  // never pointed the SDK at this product's credential store, and a ChatGPT sign-in that worked in
  // the TUI failed here with "no ChatGPT credential found".
  // BEFORE anything resolves an SDK path: this decides which directory the transcripts, the trust
  // store and the collector all use, and a later call would move the root out from under whatever
  // already read it.
  installConfiguredHome({
    env: process.env,
    home: homedir(),
    read: () => resolveEffectiveConfig({ cwd: process.cwd() }),
    onWarn: (m) => process.stderr.write(`${m}\n`),
  })
  installAuthHome(process.env, homedir())
  // Headless runs the same hooks and fails the same way — see `claude-project-dir.ts`.
  installClaudeProjectDir(process.env, process.cwd())
}

/**
 * The modes that answer before anything is set up: a usage error, and help.
 *
 * B-023 — help is a SUCCESS. It used to be reachable only by triggering the error path, so asking
 * for help exited 1 and printed a complaint about a mistake the user had not made.
 */
function handledBeforeBootstrap(args: ExecArgs): args is ExecUsageError | ExecHelp | ExecVersion {
  // #128 — before anything is set up, and on stdout with exit 0. A version that needs a working
  // configuration to print is useless in exactly the bug report that needs it most.
  if (args.mode === 'version') {
    process.stdout.write(`${AGENT.name} ${AGENT.version}\n`)
    return true
  }
  if (args.mode === 'error') {
    process.stderr.write(`${args.message}\n\n${USAGE}\n`)
    process.exit(1)
  }
  if (args.mode === 'help') {
    process.stdout.write(`${args.usage}\n`)
    return true
  }
  return false
}

async function main(): Promise<void> {
  // The local `shared/shutdown.ts` was deleted in favour of the framework's, which is the same
  // mechanism with more information: cleanups are NAMED (a watchdog timeout can say WHICH one hung,
  // not merely that one did), `run()` returns the outcome, and the three outcomes get three exit
  // codes instead of two.
  //
  // Behaviour change, deliberate: a clean Ctrl-C now exits 130 rather than 0. 130 is the Unix
  // convention for "terminated by SIGINT" (128 + 2), and it is what distinguishes an interrupted run
  // from a completed one for anything wrapping this process. B-045 raised exactly that distinction
  // and the local version could only express two of the three states.
  const shutdown = createShutdown({
    onSignal: (sig, fn) => {
      process.on(sig, fn)
    },
    exit: (code) => {
      process.exit(code)
    },
    onWarn: (message) => process.stderr.write(`[exec] ${message}\n`),
  })

  const args = parseExecArgs(process.argv.slice(2), process.stdin.isTTY === true)
  if (handledBeforeBootstrap(args)) return
  if (args.cd !== undefined) process.chdir(args.cd)

  // BEFORE `bootstrap()`: the whole point of this command is to be reachable when configuration
  // cannot be loaded, and `bootstrap` resolves the effective config. Running it after would mean the
  // command the loader's refusal names is itself blocked by that refusal.
  if (args.mode === 'migrate-config') {
    migrateConfigCommand(process.cwd())
    return
  }

  // AFTER chdir: `.env` belongs to the directory the user selected, not the one they started in.
  bootstrap()

  if (args.mode === 'sessions') return sessionsCommand(args)
  if (args.mode === 'doctor') return doctorCommand(args)

  gitGate(args.skipGitCheck)

  switch (args.mode) {
    case 'review':
      return reviewCommand(args, shutdown)
    case 'goal':
      return goalCommand(args, shutdown)
    case 'run':
    case 'resume':
      return runCommand(args, shutdown)
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
