import cac from 'cac'

interface CliOptions {
  port?: string | number
  target?: string
  upgradeReadiness?: string | number
  json?: boolean
  allowWarnings?: boolean
  force?: boolean
  dryRun?: boolean
}

const cli = cac('theokit')

cli
  .command('dev', 'Start development server')
  .option('--port <port>', 'Port number')
  .action(async (options: CliOptions) => {
    const { devCommand } = await import('./commands/dev.js')
    await devCommand({ port: options.port ? Number(options.port) : undefined })
  })

cli
  .command('build', 'Build for production')
  .option('--target <target>', 'Deploy target (node, vercel, cloudflare)')
  .action(async (options: CliOptions) => {
    try {
      const { buildCommand } = await import('./commands/build.js')
      await buildCommand({ target: options.target })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${msg}\n`)
      process.exit(1)
    }
  })

cli
  .command('start', 'Start production server')
  .option('--port <port>', 'Port number')
  .action(async (options: CliOptions) => {
    try {
      const { startCommand } = await import('./commands/start/index.js')
      await startCommand({ port: options.port ? Number(options.port) : undefined })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${msg}\n`)
      process.exit(1)
    }
  })

cli
  .command(
    'generate <type> <name> [...fields]',
    'Scaffold a route, action, page, ws, controller, agent, toolbox, workflow, eval, sandbox, schedule, memory, or resource (resource accepts field:type args)',
  )
  .action(async (type: string, name: string, fields: string[]) => {
    try {
      const { generateCommand } = await import('./commands/generate.js')
      await generateCommand(type, name, fields.length > 0 ? fields : undefined)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${msg}\n`)
      process.exit(1)
    }
  })

cli
  .command(
    'agent <name> [message]',
    'Run an agent in the terminal (stream + tool calls + approval)',
  )
  .action(async (name: string, message: string | undefined) => {
    try {
      const { agentCommand } = await import('./commands/agent.js')
      const { sawError } = await agentCommand(name, message)
      // The run ended with an error chunk (already rendered) — exit non-zero so `$?` / CI reflects it.
      if (sawError) process.exit(1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${msg}\n`)
      process.exit(1)
    }
  })

cli
  .command('mcp <agent>', 'Serve an agent as an MCP server over stdio (for desktop MCP clients)')
  .action(async (agent: string) => {
    try {
      const { mcpCommand } = await import('./commands/mcp.js')
      await mcpCommand(agent)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${msg}\n`)
      process.exit(1)
    }
  })

cli.command('routes', 'List all routes, actions, and WebSocket endpoints').action(async () => {
  try {
    const { routesCommand } = await import('./commands/routes.js')
    await routesCommand()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\n  ✗ ${msg}\n`)
    process.exit(1)
  }
})

cli
  .command('check', 'Run typecheck + scan + (optional) eslint')
  .option(
    '--upgrade-readiness <version>',
    'Scan source for anticipated breakage under a future TheoKit version (currently supports 0.3). See docs/migration/0.2-to-0.3.md',
  )
  .option('--json', 'Emit machine-readable JSON (only with --upgrade-readiness)')
  .option(
    '--allow-warnings',
    'Do not fail the build when violations are present (only with --upgrade-readiness)',
  )
  .action(async (options: CliOptions) => {
    // cac may coerce `0.3` to a JS number — normalize before comparing.
    const targetRaw = options.upgradeReadiness
    if (targetRaw !== undefined) {
      const target = String(targetRaw)
      if (target !== '0.3') {
        console.error(`\n  ✗ --upgrade-readiness: only '0.3' is supported (got '${target}')\n`)
        process.exit(1)
      }
      const { upgradeReadinessCommand } = await import('./commands/upgrade-readiness.js')
      await upgradeReadinessCommand({
        json: Boolean(options.json),
        allowWarnings: Boolean(options.allowWarnings),
      })
      return
    }
    const { checkCommand } = await import('./commands/check.js')
    await checkCommand()
  })

cli
  .command('add <package>', 'Install a known TheoKit adapter or plugin (whitelist-only)')
  .action(async (pkg: string) => {
    const { addCommand } = await import('./commands/add.js')
    await addCommand(pkg)
  })

cli.command('info', 'Print environment info (runtime, config, routes)').action(async () => {
  const { infoCommand } = await import('./commands/info.js')
  await infoCommand()
})

cli
  .command(
    'openapi',
    'Generate <distDir>/openapi.json from route schemas (opt-in via config.openapi)',
  )
  .option('--dry-run', 'Print the document to stdout without writing to disk (EC-3)')
  .action(async (options: CliOptions) => {
    try {
      const { openapiCommand } = await import('./commands/openapi.js')
      await openapiCommand({ dryRun: Boolean(options.dryRun) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${msg}\n`)
      process.exit(1)
    }
  })

cli
  .command(
    'migrate <kind>',
    'Run a one-shot convention migration. Supported: router (G6 dotted→nested), services-json-v1-to-v2 (Plan v1.2 T2.3)',
  )
  .option('--dry-run', 'Print the migration plan but do not touch the filesystem')
  .option('--force', 'Skip the dev-server port pre-flight check (CI / non-TTY)')
  .option('--name <slug>', 'Explicit project name (DNS-1123). Services-json migrate only.')
  .action(async (kind: string, options: CliOptions & { name?: string }) => {
    try {
      if (kind === 'router') {
        const { routerMigrateCommand } = await import('./commands/migrate/router.js')
        await routerMigrateCommand({
          dryRun: Boolean(options.dryRun),
          force: Boolean(options.force),
        })
        return
      }
      if (kind === 'services-json-v1-to-v2' || kind === 'services-json') {
        const { servicesJsonMigrateCommand } = await import('./commands/migrate/services-json.js')
        await servicesJsonMigrateCommand({
          dryRun: Boolean(options.dryRun),
          name: options.name,
        })
        return
      }
      console.error(
        `\n  ✗ Unknown migration kind: ${kind}. Supported: router, services-json-v1-to-v2\n`,
      )
      process.exit(1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${msg}\n`)
      process.exit(1)
    }
  })

cli
  .command('docker', 'Generate Dockerfile for production')
  .option('--force', 'Overwrite existing Dockerfile')
  .action(async (options: CliOptions) => {
    try {
      const { dockerCommand } = await import('./commands/docker.js')
      await dockerCommand({ force: options.force })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${msg}\n`)
      process.exit(1)
    }
  })

cli
  .command('db <action>', 'Database commands: migrate (push schema), generate (SQL files), seed')
  .action(async (action: string) => {
    try {
      const { dbCommandCli } = await import('./commands/db.js')
      dbCommandCli(action)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${msg}\n`)
      process.exit(1)
    }
  })

cli.help()
cli.version('0.1.0-alpha.0')

export function main(): void {
  cli.parse()
}

// Auto-execute when run as script
main()
