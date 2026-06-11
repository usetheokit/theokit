/**
 * Interactive prompts for create-theokit.
 * Skipped when --yes flag is passed (uses defaults).
 *
 * Uses Node.js readline (zero deps) — not inquirer/prompts.
 */
import { createInterface } from 'node:readline'

export interface ProjectOptions {
  projectName: string
  typescript: boolean
  eslint: boolean
  tailwind: boolean
  srcDir: boolean
  aliases: boolean
  agentsMd: boolean
}

const DEFAULTS: Omit<ProjectOptions, 'projectName'> = {
  typescript: true,
  eslint: true,
  tailwind: true,
  srcDir: false,
  aliases: true,
  agentsMd: true,
}

async function ask(rl: ReturnType<typeof createInterface>, question: string, defaultVal: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const suffix = defaultVal ? '(Y/n)' : '(y/N)'
    rl.question(`  ${question} ${suffix} `, (answer) => {
      const a = answer.trim().toLowerCase()
      if (a === '') resolve(defaultVal)
      else resolve(a === 'y' || a === 'yes')
    })
  })
}

async function askChoice(rl: ReturnType<typeof createInterface>, question: string, choices: string[], defaultIdx = 0): Promise<number> {
  return new Promise((resolve) => {
    console.log(`  ${question}`)
    for (let i = 0; i < choices.length; i++) {
      const marker = i === defaultIdx ? '❯' : ' '
      console.log(`    ${marker} ${choices[i]}`)
    }
    rl.question('  Choice (number): ', (answer) => {
      const n = parseInt(answer.trim(), 10)
      resolve(n >= 1 && n <= choices.length ? n - 1 : defaultIdx)
    })
  })
}

export async function runPrompts(projectName: string): Promise<ProjectOptions> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  try {
    console.log('')
    const mode = await askChoice(rl, 'Would you like to use the recommended TheoKit defaults?', [
      'Yes, use recommended defaults — TypeScript, ESLint, Tailwind CSS, AGENTS.md',
      'No, customize settings',
    ], 0)

    if (mode === 0) {
      return { projectName, ...DEFAULTS }
    }

    const typescript = await ask(rl, 'Would you like to use TypeScript?', true)
    const eslint = await ask(rl, 'Would you like to use ESLint?', true)
    const tailwind = await ask(rl, 'Would you like to use Tailwind CSS?', true)
    const srcDir = await ask(rl, 'Would you like your code inside a `src/` directory?', false)
    const aliases = await ask(rl, 'Would you like to use import alias (@/*)?', true)
    const agentsMd = await ask(rl, 'Would you like to include AGENTS.md for coding agents?', true)

    return { projectName, typescript, eslint, tailwind, srcDir, aliases, agentsMd }
  } finally {
    rl.close()
  }
}

export function getDefaults(projectName: string): ProjectOptions {
  return { projectName, ...DEFAULTS }
}
