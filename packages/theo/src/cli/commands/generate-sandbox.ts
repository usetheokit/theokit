/**
 * The `theokit generate sandbox` template: an agent tool that runs a shell command.
 */
import { toCamelCase } from './generate-names.js'

/**
 * usetheokit/theokit#1070 — this template used to describe `LocalSandbox` as "isolated" and "SAFELY"
 * runnable, to the developer in the doc comment and to the model in the tool description, while the
 * SDK documents `LocalSandbox` as not an isolation boundary: a generated tool wrote into the app
 * directory, read `/etc/passwd` and resolved DNS. The generated tool now asks for bubblewrap
 * confinement through `createSandboxBackend`, checks `resolveSandboxPosture` before every command,
 * and refuses to run unconfined unless the developer opts in by name. The text claims nothing more.
 */
export function generateSandboxTemplate(name: string): string {
  const camel = toCamelCase(name)
  const base = name.split('/').pop() ?? name
  const snake = base.replace(/-/g, '_')
  return [
    `import { mkdtempSync } from 'node:fs'`,
    `import { tmpdir } from 'node:os'`,
    `import { join } from 'node:path'`,
    ``,
    `import {`,
    `  createSandboxBackend,`,
    `  resolveSandboxPosture,`,
    `  SandboxNotAvailableError,`,
    `} from '@theokit/sdk/sandbox'`,
    `import { tool } from 'theokit/server/define'`,
    `import { z } from 'zod'`,
    ``,
    `/**`,
    ` * An agent tool that runs a shell command under bubblewrap confinement (Linux): the filesystem is`,
    ` * read-only apart from a scratch directory and /tmp, the network is cut, and the environment is`,
    ` * reduced to an allowlist. The command can still READ anything your user can read. Confinement`,
    ` * limits what a command can change; it is not a boundary for hostile code, which needs a container`,
    ` * or VM backend.`,
    ` *`,
    ` * Where bubblewrap is missing or cannot run (macOS, Windows, many containers) nothing confines the`,
    ` * command, so the tool refuses with \`SandboxNotAvailableError\`. To run commands on the host anyway,`,
    ` * with your user's full filesystem and network access, set THEOKIT_SANDBOX_ALLOW_UNCONFINED=1, and`,
    ` * only for commands you trust.`,
    ` *`,
    ` * Connect it to your agent with \`.tool(...)\`:`,
    ` *`,
    ` *   // agents/chat.ts`,
    ` *   import { ${camel}Tool } from './sandbox/${base}.js'`,
    ` *   AgentBuilder.create().model(...).tool(${camel}Tool).build()`,
    ` */`,
    `const MODE = 'workspace-write'`,
    `let scratchDir: string | undefined`,
    ``,
    `export const ${camel}Tool = tool('${snake}')`,
    `  .describe('Run a shell command and return its output.')`,
    `  .input(z.object({ command: z.string().describe('The shell command to run, e.g. "ls -la"') }))`,
    `  .execute(async ({ command }) => {`,
    `    const posture = resolveSandboxPosture({ mode: MODE })`,
    `    if (!posture.enforced && process.env.THEOKIT_SANDBOX_ALLOW_UNCONFINED !== '1') {`,
    `      throw new SandboxNotAvailableError(`,
    `        \`Refusing to run the command without confinement: \${posture.detail}. \` +`,
    `          'Install bubblewrap, or set THEOKIT_SANDBOX_ALLOW_UNCONFINED=1 to run it on the host.',`,
    `      )`,
    `    }`,
    `    scratchDir ??= mkdtempSync(join(tmpdir(), '${base}-'))`,
    `    const sandbox = createSandboxBackend({ mode: MODE, workDir: scratchDir, timeoutMs: 5_000 })`,
    `    const { stdout, stderr, exitCode } = await sandbox.execute(command)`,
    `    return exitCode === 0 ? stdout : \`exit \${exitCode}: \${stderr}\``,
    `  })`,
    `  .build()`,
    ``,
  ].join('\n')
}
