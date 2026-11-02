#!/usr/bin/env node
/**
 * Runs one parity task on TheoCode and on one competitor (Claude Code or Codex) and computes the
 * result from the verification command's pass and fail count (B-418, PIECE-20, OBJ-11).
 *
 * The method of `docs/parity/2026-08-25-codex-parity.md` was prose followed by hand: two truncated
 * hashes typed into a document, and one dispatched seed that already passed before either agent
 * touched it (found only by diffing afterwards). This script is that method as code:
 *
 *   1. both sides must run the same provider, model and effort, or the caller declares the run
 *      not like for like (`--not-like-for-like "<reason>"`), and the record says it is not counted;
 *   2. the seed is copied once per side under a fresh `git init`, both copies are hashed, and a
 *      mismatch refuses the run with both hashes;
 *   3. the verification command runs on the untouched seed first, and a seed that already passes
 *      refuses the run;
 *   4. after each agent finishes, the task's `verify/` files are copied over its tree (so an agent
 *      that edits a test cannot make it pass) and the verification command decides the outcome.
 *      The agent's own final message is recorded and never read for the verdict.
 *
 * A task is a directory: `task.json` ({ id, title, prompt, verify: [cmd, ...args] }), `seed/` and
 * `verify/`. The verification command must print the node test runner's TAP totals
 * (`# pass N`, `# fail N`).
 *
 *   node tools/side-by-side.mjs --task docs/parity/tasks/t1-duration-parser \
 *     --competitor claude --theocode-model anthropic/claude-sonnet-4-5 \
 *     --competitor-model claude-sonnet-4-5 --competitor-provider anthropic [--effort medium] \
 *     [--competitor-effort medium] [--not-like-for-like "<reason>"] [--out docs/parity/runs]
 *
 *   node tools/side-by-side.mjs --check-seeds docs/parity/tasks
 *     proves every task's seed fails its verification and prints its hash; runs no agent.
 *
 * Not in the `lint` chain: it drives two agent CLIs against real models, which a check cannot do.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

class SideBySideError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = new.target.name
  }
}

export class SeedMismatchError extends SideBySideError {
  /** @param {string} first @param {string} second */
  constructor(first, second) {
    super(
      `seed copies differ: ${first} != ${second}; refusing to compare two different starting trees`,
    )
    this.first = first
    this.second = second
  }
}

export class SeedAlreadyPassesError extends SideBySideError {
  /** @param {string} taskId @param {{ pass: number, fail: number }} counts */
  constructor(taskId, counts) {
    super(
      `task ${taskId}: the untouched seed already passes its verification (${counts.pass} pass, ${counts.fail} fail); the task measures nothing`,
    )
  }
}

export class UnlikeSidesError extends SideBySideError {
  /** @param {string[]} differences */
  constructor(differences) {
    super(
      `the two sides differ (${differences.join('; ')}) and the run does not declare it; pass --not-like-for-like "<reason>" to record it as not counted`,
    )
    this.differences = differences
  }
}

class UnparsableVerificationError extends SideBySideError {
  /** @param {string} output */
  constructor(output) {
    super(
      `the verification output carries no "# pass N" and "# fail N" totals; last lines: ${output.trim().split('\n').slice(-5).join(' | ')}`,
    )
  }
}

class UsageError extends SideBySideError {}

const COMPETITORS = ['claude', 'codex']

/**
 * The hash of a tree: every regular file's relative path and bytes, in sorted order, `.git` left out.
 * @param {string} root
 */
async function hashTree(root) {
  const files = await listFiles(root, root)
  files.sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(`${file}\0`)
    hash.update(await readFile(join(root, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** @param {string} root @param {string} dir @returns {Promise<string[]>} */
async function listFiles(root, dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.name !== '.git')
      .map((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return listFiles(root, path)
        return [relative(root, path).split('\\').join('/')]
      }),
  )
  return nested.flat()
}

/** @param {string} first @param {string} second */
export async function assertSeedsIdentical(first, second) {
  const [a, b] = await Promise.all([hashTree(first), hashTree(second)])
  if (a !== b) throw new SeedMismatchError(a, b)
  return a
}

/** @param {string} output */
export function parseTestCounts(output) {
  const pass = output.match(/^# pass (\d+)$/m)
  const fail = output.match(/^# fail (\d+)$/m)
  if (!pass || !fail) throw new UnparsableVerificationError(output)
  return { pass: Number(pass[1]), fail: Number(fail[1]) }
}

/** A side solved the task only when at least one check ran and none failed. */
function sideOutcome(/** @type {{ pass: number, fail: number }} */ counts) {
  return counts.fail === 0 && counts.pass > 0 ? 'solved' : 'failed'
}

/** @param {'solved'|'failed'} theocode @param {'solved'|'failed'} competitor */
export function computeVerdict(theocode, competitor) {
  if (theocode === competitor) return theocode === 'solved' ? 'equal' : 'both_failed'
  return theocode === 'solved' ? 'theocode_won' : 'theocode_lost'
}

/** `provider/model` → the model without its provider prefix. */
function bareModel(/** @type {string} */ model) {
  return model.includes('/') ? model.slice(model.indexOf('/') + 1) : model
}

/**
 * @param {{ provider: string, model: string, effort: string | null }} theocode
 * @param {{ provider: string, model: string, effort: string | null }} competitor
 * @param {string | null} declaration the not-like-for-like reason, or null
 */
function assessLikeForLike(theocode, competitor, declaration) {
  const differences = []
  if (theocode.provider !== competitor.provider)
    differences.push(`provider ${theocode.provider} vs ${competitor.provider}`)
  if (bareModel(theocode.model) !== bareModel(competitor.model))
    differences.push(`model ${theocode.model} vs ${competitor.model}`)
  if ((theocode.effort ?? null) !== (competitor.effort ?? null))
    differences.push(`effort ${theocode.effort ?? 'unset'} vs ${competitor.effort ?? 'unset'}`)
  const reason = declaration?.trim() || null
  if (differences.length > 0 && !reason) throw new UnlikeSidesError(differences)
  return {
    likeForLike: differences.length === 0,
    differences,
    declaration: reason,
    counted: differences.length === 0,
  }
}

/** @typedef {(cmd: string, args: string[], options: { cwd: string }) => Promise<{ code: number, stdout: string, stderr: string }>} Exec */

/** @type {Exec} */
export function spawnExec(cmd, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) =>
      reject(new SideBySideError(`cannot start ${cmd}: ${error.message}`)),
    )
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/** @param {string} taskDir */
async function loadTask(taskDir) {
  const task = JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8'))
  for (const key of ['id', 'title', 'prompt'])
    if (typeof task[key] !== 'string' || task[key].trim() === '')
      throw new UsageError(`${taskDir}/task.json: "${key}" must be a non-empty string`)
  if (!Array.isArray(task.verify) || task.verify.length === 0)
    throw new UsageError(`${taskDir}/task.json: "verify" must be a non-empty command array`)
  return { ...task, seedDir: join(taskDir, 'seed'), verifyDir: join(taskDir, 'verify') }
}

/** @param {Exec} exec @param {string} seedDir @param {string} dest */
async function prepareCopy(exec, seedDir, dest) {
  await cp(seedDir, dest, { recursive: true })
  const git = (/** @type {string[]} */ args) => exec('git', args, { cwd: dest })
  await git(['init', '--quiet'])
  await git(['add', '-A'])
  await git([
    '-c',
    'user.name=side-by-side',
    '-c',
    'user.email=side-by-side@localhost',
    'commit',
    '--quiet',
    '-m',
    'seed',
  ])
}

/** @param {Exec} exec @param {{ verify: string[], verifyDir: string }} task @param {string} dir */
async function verifyTree(exec, task, dir) {
  await cp(task.verifyDir, dir, { recursive: true, force: true })
  const [cmd, ...args] = task.verify
  const result = await exec(cmd, args, { cwd: dir })
  return parseTestCounts(`${result.stdout}\n${result.stderr}`)
}

/**
 * Proves a task's seed fails its verification and returns the seed's hash. No agent runs.
 * @param {Exec} exec @param {Awaited<ReturnType<typeof loadTask>>} task @param {string} workRoot
 */
async function checkSeed(exec, task, workRoot) {
  const dir = join(workRoot, `${task.id}-seed-check`)
  await prepareCopy(exec, task.seedDir, dir)
  const seedHash = await hashTree(task.seedDir)
  const counts = await verifyTree(exec, task, dir)
  if (sideOutcome(counts) === 'solved') throw new SeedAlreadyPassesError(task.id, counts)
  return { seedHash, counts }
}

/**
 * @param {'theocode'|'claude'|'codex'} name
 * @param {{ bin: string, model: string, effort: string | null }} side
 * @param {string} dir @param {string} prompt
 */
function agentCommand(name, side, dir, prompt) {
  const effort = side.effort
  if (name === 'theocode')
    return [
      side.bin,
      [
        'run',
        '-C',
        dir,
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '-a',
        'never',
        '-m',
        side.model,
        ...(effort ? ['--effort', effort] : []),
        '--json',
        prompt,
      ],
    ]
  if (name === 'codex')
    return [
      side.bin,
      [
        'exec',
        '--skip-git-repo-check',
        '-m',
        side.model,
        ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : []),
        '--dangerously-bypass-approvals-and-sandbox',
        prompt,
      ],
    ]
  if (effort)
    throw new UsageError(
      'claude takes no effort flag here; leave --competitor-effort unset and declare the run not like for like if TheoCode sets one',
    )
  return [side.bin, ['-p', prompt, '--model', side.model, '--dangerously-skip-permissions']]
}

/** @param {Exec} exec @param {string} name @param {any} side @param {any} task @param {string} dir */
async function runSide(exec, name, side, task, dir) {
  const version = await exec(side.bin, ['--version'], { cwd: dir })
  const [cmd, args] = agentCommand(name, side, dir, task.prompt)
  const agent = await exec(cmd, args, { cwd: dir })
  const counts = await verifyTree(exec, task, dir)
  return {
    name,
    cliVersion: version.stdout.trim() || null,
    provider: side.provider,
    model: side.model,
    effort: side.effort,
    agentExitCode: agent.code,
    agentFinalOutput: agent.stdout.trim().split('\n').slice(-3).join('\n'),
    counts,
    outcome: sideOutcome(counts),
  }
}

/**
 * Runs one task on both sides and returns the record. Refuses before any agent runs on an unlike
 * pair without a declaration, on a seed that already passes, and on seed copies that differ.
 * @param {{ taskDir: string, theocode: any, competitorName: 'claude'|'codex', competitor: any, notLikeForLike: string | null, exec?: Exec, workRoot?: string, now?: () => Date }} options
 */
export async function runTask(options) {
  const { taskDir, theocode, competitorName, competitor, notLikeForLike } = options
  const exec = options.exec ?? spawnExec
  if (!COMPETITORS.includes(competitorName))
    throw new UsageError(`--competitor must be one of ${COMPETITORS.join(', ')}`)
  const comparison = assessLikeForLike(theocode, competitor, notLikeForLike)
  const task = await loadTask(taskDir)
  const workRoot = options.workRoot ?? (await mkdtemp(join(tmpdir(), 'side-by-side-')))
  const { seedHash, counts: seedCounts } = await checkSeed(exec, task, workRoot)
  const theoDir = join(workRoot, `${task.id}-theocode`)
  const compDir = join(workRoot, `${task.id}-${competitorName}`)
  await prepareCopy(exec, task.seedDir, theoDir)
  await prepareCopy(exec, task.seedDir, compDir)
  const copyHash = await assertSeedsIdentical(theoDir, compDir)
  if (copyHash !== seedHash) throw new SeedMismatchError(seedHash, copyHash)
  const theoSide = await runSide(exec, 'theocode', theocode, task, theoDir)
  const compSide = await runSide(exec, competitorName, competitor, task, compDir)
  return {
    task: task.id,
    title: task.title,
    date: (options.now ?? (() => new Date()))().toISOString(),
    prompt: task.prompt,
    seedHash,
    seedCounts,
    verify: task.verify.join(' '),
    sides: [theoSide, compSide],
    ...comparison,
    verdict: computeVerdict(theoSide.outcome, compSide.outcome),
  }
}

/** @param {any} record @param {string} outDir */
export async function writeRecord(record, outDir) {
  await mkdir(outDir, { recursive: true })
  const path = join(
    outDir,
    `${record.date.slice(0, 10)}-${record.task}-${record.sides[1].name}.json`,
  )
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`)
  return path
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const flags = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key.startsWith('--') || value === undefined || value.startsWith('--'))
      throw new UsageError(`expected "--flag value" pairs, got "${key}"`)
    flags[key.slice(2)] = value
  }
  return flags
}

/** @param {Record<string, string>} flags @param {string} name */
function required(flags, name) {
  const value = flags[name]?.trim()
  if (!value) throw new UsageError(`--${name} is required`)
  return value
}

/** @param {string} root @param {Exec} exec */
async function checkAllSeeds(root, exec) {
  const workRoot = await mkdtemp(join(tmpdir(), 'side-by-side-seeds-'))
  const dirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory())
  for (const dir of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const task = await loadTask(join(root, dir.name))
    const { seedHash, counts } = await checkSeed(exec, task, workRoot)
    console.log(
      `${task.id}  ${seedHash}  seed fails as it must: ${counts.pass} pass, ${counts.fail} fail`,
    )
  }
  await rm(workRoot, { recursive: true, force: true })
}

/** @param {string[]} argv @param {Exec} [exec] */
async function main(argv, exec = spawnExec) {
  const flags = parseArgs(argv)
  if (flags['check-seeds']) return checkAllSeeds(flags['check-seeds'], exec)
  const theocodeModel = required(flags, 'theocode-model')
  const record = await runTask({
    taskDir: required(flags, 'task'),
    competitorName: /** @type {'claude'|'codex'} */ (required(flags, 'competitor')),
    theocode: {
      bin: flags['theocode-bin'] ?? 'theocode',
      provider: theocodeModel.includes('/')
        ? theocodeModel.slice(0, theocodeModel.indexOf('/'))
        : 'unknown',
      model: theocodeModel,
      effort: flags.effort ?? null,
    },
    competitor: {
      bin: flags['competitor-bin'] ?? required(flags, 'competitor'),
      provider: required(flags, 'competitor-provider'),
      model: required(flags, 'competitor-model'),
      effort: flags['competitor-effort'] ?? null,
    },
    notLikeForLike: flags['not-like-for-like'] ?? null,
    exec,
  })
  const path = await writeRecord(record, flags.out ?? 'docs/parity/runs')
  console.log(
    `${record.task}: ${record.verdict}${record.counted ? '' : ' (not like for like, not counted)'} -> ${path}`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof SideBySideError ? `side-by-side: ${error.message}` : error)
    process.exitCode = 1
  })
}
