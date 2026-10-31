/**
 * The builds the live-model job needs, defined once so the pull-request check in ci.yml builds
 * exactly what the live job on develop builds (B-659). A selector that omitted TheoClaw
 * (`theoclaw^...`, B-651) merged green because these builds ran only after the merge.
 *
 *   node scripts/live-model-build.mjs                    both builds, agents first
 *   node scripts/live-model-build.mjs agents|theoclaw    one build
 *   node scripts/live-model-build.mjs --print-selector agents|theoclaw
 *
 * The theoclaw target also builds the WebChat page (`build:web`), which TheoClaw's live tests serve.
 *
 * Exit 1 names the build that failed, could not start or was killed, or the TheoClaw entry or
 * WebChat bundle the build did not produce; exit 2 names an argument it does not take.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** `name...` is the package and its workspace dependencies; `name^...` leaves the package out. */
const SELECTORS = { agents: '@theokit/agents...', theoclaw: 'theoclaw...' }

/** Spawned by TheoClaw's control-plane and instance-profiles live tests. */
const THEOCLAW_ENTRY = 'apps/theoclaw/dist/main.js'

/**
 * The WebChat page bundle `build:web` writes, which TheoClaw serves at GET /webchat: without it the
 * page answers 503 and tests/live/webchat.live.test.ts fails (gateway-webchat review F-wire-1).
 */
const WEBCHAT_BUNDLE = 'apps/theoclaw/dist/web/assets/app.js'
const WEBCHAT_BUILD = 'the WebChat page (build:web)'

const USAGE = 'expected agents, theoclaw or --print-selector agents|theoclaw'

/** @param {string} message @returns {never} */
function fail(message, code = 1) {
  process.stderr.write(`live-model-build: ${message}\n`)
  process.exit(code)
}

/** @param {string | undefined} target @returns {target is keyof typeof SELECTORS} */
function isTarget(target) {
  return target !== undefined && Object.hasOwn(SELECTORS, target)
}

/**
 * One target, or none for both. Exit 2 names the first argument it does not take.
 * @param {string[]} args @returns {(keyof typeof SELECTORS)[]}
 */
function oneTarget(args, missing = '') {
  const [target, extra] = args
  if (args.length === 0 && missing === '') return ['agents', 'theoclaw']
  if (isTarget(target) && extra === undefined) return [target]
  return fail(`unknown argument ${isTarget(target) ? extra : (target ?? missing)}; ${USAGE}`, 2)
}

/** @param {string[]} argv @returns {(keyof typeof SELECTORS)[]} */
function parseTargets(argv) {
  if (argv[0] !== '--print-selector') return oneTarget(argv)
  const [target] = oneTarget(argv.slice(1), '--print-selector')
  process.stdout.write(`${SELECTORS[target]}\n`)
  return process.exit(0)
}

/**
 * Run `pnpm <args>`; `label` names it in the failure.
 * @param {string[]} args @param {string} label
 */
function pnpm(args, label) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
  const result = spawnSync('pnpm', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, TURBO_CONCURRENCY: '1' },
  })
  // A build that could not start or was killed has status null: never read it as a pass.
  if (result.error !== undefined) fail(`building ${label} could not run: ${result.error.message}`)
  if (result.status !== 0) {
    const how = result.status === null ? `signal ${result.signal}` : `status ${result.status}`
    fail(`building ${label} failed with ${how}`)
  }
}

/** @param {string} entry @param {string} built */
function requireOutput(entry, built) {
  if (!existsSync(join(ROOT, entry))) fail(`${entry} is missing after building ${built}`)
}

/** @param {keyof typeof SELECTORS} target */
function build(target) {
  pnpm(['--filter', SELECTORS[target], 'build'], SELECTORS[target])
  if (target !== 'theoclaw') return
  requireOutput(THEOCLAW_ENTRY, SELECTORS.theoclaw)
  pnpm(['--filter', 'theoclaw', 'run', 'build:web'], WEBCHAT_BUILD)
  requireOutput(WEBCHAT_BUNDLE, WEBCHAT_BUILD)
}

for (const target of parseTargets(process.argv.slice(2))) build(target)
