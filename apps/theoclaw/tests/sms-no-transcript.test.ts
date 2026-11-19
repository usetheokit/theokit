import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEXT = ['unique', 'inbound', 'heron', String(7731)].join('-')

/** Every file under `directory`, walked. */
function files(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

/** A chat-completions server that answers "pong" and counts the requests. */
async function modelServer() {
  let requests = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      requests++
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ id: '1', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`
      response.end(chunk({ role: 'assistant', content: 'pong' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests: () => requests, close: () => server.close() }
}

describe('an SMS channel turn through the process entry (#1457)', () => {
  it('leaves no file holding the inbound text under HOME, the working directory, the workspace or the app dir', { timeout: 60_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'sms-home-'))
    const workspace = mkdtempSync(join(tmpdir(), 'sms-ws-'))
    const cwd = mkdtempSync(join(tmpdir(), 'sms-cwd-'))
    const model = await modelServer()
    const port = 20000 + Math.floor(Math.random() * 20000)
    const url = `http://127.0.0.1:${port}/webhooks/sms`
    const token = 'tok123456789'
    const child = spawn(process.execPath, ['--import', join(APP, 'node_modules/tsx/dist/loader.mjs'), join(APP, 'src/main.ts')], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CONFIG_HOME: join(home, 'cfg'),
        THEOCLAW_MODEL: 'openai/stub',
        OPENROUTER_API_KEY: 'sk-stub-key-0123456789',
        OPENAI_API_BASE_URL: model.url,
        THEOCLAW_PORT: String(port),
        THEOCLAW_DM_POLICY: 'open',
        THEOCLAW_OWNERS: 'telegram:1',
        THEOCLAW_WORKSPACE: workspace,
        THEOCLAW_SMS_TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`,
        THEOCLAW_SMS_TWILIO_AUTH_TOKEN: token,
        THEOCLAW_SMS_TWILIO_FROM_NUMBER: '+12025550123',
        THEOCLAW_SMS_PUBLIC_URL: url,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    try {
      const started = Date.now()
      while (!output.includes('control plane listening') && Date.now() - started < 30_000) await new Promise((resolve) => setTimeout(resolve, 100))
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const params: Record<string, string> = { MessageSid: `SM${'a'.repeat(32)}`, AccountSid: `AC${'1'.repeat(32)}`, From: '+14155552671', To: '+12025550123', Body: TEXT }
      const signature = createHmac('sha1', token)
        .update(url + Object.keys(params).sort().map((key) => key + params[key]).join(''))
        .digest('base64')
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
        body: new URLSearchParams(params),
      })
      expect(response.status, output).toBe(200)
      const deadline = Date.now() + 15_000
      while (model.requests() === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
      expect(model.requests()).toBeGreaterThan(0)
      // The SDK writes a transcript when the agent is disposed or the turn ends; give both time.
      await new Promise((resolve) => setTimeout(resolve, 3000))
      child.kill('SIGTERM')
      await new Promise((resolve) => child.once('exit', resolve))
      for (const directory of [home, workspace, cwd, APP]) {
        const holders = files(directory).filter((file) => !file.includes('node_modules') && !file.endsWith('.lock') && readFileSync(file, 'utf8').includes(TEXT))
        expect(holders, directory).toEqual([])
      }
      expect(files(join(home, '.theokit', 'projects')).filter((file) => file.endsWith('.jsonl'))).toEqual([])
    } finally {
      child.kill('SIGKILL')
      model.close()
      for (const directory of [home, workspace, cwd]) rmSync(directory, { recursive: true, force: true })
    }
  })
})
