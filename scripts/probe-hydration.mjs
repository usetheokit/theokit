#!/usr/bin/env node
/**
 * Report what a real browser throws while hydrating a real build.
 *
 * usetheokit/theokit#? — B-229's Definition-of-done names `node scripts/probe-hydration.mjs` as its
 * oracle, and the file was in no commit: `git log --all --diff-filter=A -- '*probe-hydration*'`
 * returned nothing. The 2026-09-20 measurement that found React #418 used an ad-hoc script nobody
 * kept, so the item cited an instrument no one could run. That is the gap this closes.
 *
 * WHY THIS AND NOT A UNIT TEST. A hydration mismatch is the server's markup disagreeing with the
 * client's first render. Both halves have to actually run, in a browser, against a built app —
 * jsdom does not hydrate the way React hydrates, and asserting on a console string is not the same
 * as asserting no exception was thrown. React's production build emits `Minified React error #418`
 * with no component name, so the exception object is all the evidence there is; it is reported
 * verbatim rather than summarised.
 *
 * WHY NO PUPPETEER. Measured before writing: no browser driver is declared anywhere in this
 * monorepo, and Node 22 ships `WebSocket`. The Chrome DevTools Protocol is a WebSocket and a JSON
 * endpoint, so the whole driver is the two functions below. Adding a dependency to this repository
 * for one script is the rung of the parsimony ladder this stops at.
 *
 *   node scripts/probe-hydration.mjs --url http://127.0.0.1:3000
 *   node scripts/probe-hydration.mjs --url http://127.0.0.1:3000 --chrome /usr/bin/google-chrome
 *
 * Exit 0  no uncaught exception and no console error
 * Exit 1  the page threw or logged an error — each one printed with its stack
 * Exit 2  the probe could not measure (no Chrome, page never loaded, protocol error). NOT a pass:
 *         "we could not check" and "we checked and it is clean" are different facts, and a probe
 *         that reports the first as the second is worse than no probe.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function findChrome() {
  const declared = arg('chrome')
  if (declared) return existsSync(declared) ? declared : null
  return CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null
}

/** Poll the DevTools JSON endpoint until it answers, or give up. Chrome takes a moment to listen. */
async function debuggerUrl(port, deadlineMs) {
  const until = Date.now() + deadlineMs
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      const body = await res.json()
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl
    } catch {
      // Not listening yet. The deadline is the only thing that ends this loop.
    }
    await new Promise((r) => setTimeout(r, 120))
  }
  return null
}

/**
 * A minimal CDP client. `id` correlates a command with its reply; everything without an `id` is an
 * event, which is what this probe actually reads.
 */
function cdp(ws) {
  let next = 1
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    // The id is validated before it selects anything to call. Everything arriving on this socket is
    // the browser's, and this probe is pointed at URLs it does not control — so "the peer is a
    // process we spawned" is an argument about today's caller, not about the code. A Map lookup
    // does not walk the prototype, so the danger here is narrow; making the boundary explicit
    // costs two checks and removes the question. (CodeQL js/unvalidated-dynamic-method-call)
    if (typeof msg.id === 'number') {
      const resolve = pending.get(msg.id)
      if (typeof resolve === 'function') {
        pending.delete(msg.id)
        resolve(msg)
      }
      return
    }
    events.push(msg)
  })
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const id = next++
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  return { send, events }
}

/**
 * Page-authored text, made safe to print.
 *
 * Everything reported here was written by the page, and this probe is pointed at URLs it does not
 * control. Carriage returns rewrite a terminal line, and ANSI escapes recolour or reposition
 * whatever follows — so an error message can forge the probe's own verdict in the operator's
 * scrollback. Newlines survive because an exception's stack is the evidence and folding it to one
 * line destroys it. (CodeQL js/log-injection)
 */
function safe(value) {
  // eslint-disable-next-line no-control-regex -- matching control characters is the entire job
  return String(value ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
}

/**
 * Print what the page produced and decide the verdict from it.
 *
 * Extracted from `main` rather than inlined: the driver and the verdict are two jobs, and keeping
 * them together pushed `main` past the repository's cognitive-complexity ceiling. Raising that
 * ceiling to make a gate pass is the one thing the autonomy envelope forbids outright.
 */
function report(url, events) {
  const thrown = events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails)
  const logged = events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry)

  console.log(`probe-hydration: ${url}`)
  console.log(`  uncaught exceptions: ${thrown.length}`)
  console.log(`  console errors:      ${logged.length}`)

  for (const d of thrown) {
    const text = d.exception?.description ?? d.text ?? '(no description)'
    console.log(
      `\n  EXCEPTION ${safe(d.url)}:${d.lineNumber ?? '?'}\n    ${safe(text).split('\n').join('\n    ')}`,
    )
  }
  for (const e of logged) {
    console.log(`\n  CONSOLE ERROR ${safe(e.url)}:${e.lineNumber ?? '?'}\n    ${safe(e.text)}`)
  }

  if (thrown.length === 0 && logged.length === 0) {
    console.log('\n  clean — nothing thrown, nothing logged at error level')
    return 0
  }
  return 1
}

async function main() {
  const url = arg('url')
  if (!url) {
    console.error('probe-hydration: --url is required, e.g. --url http://127.0.0.1:3000')
    return 2
  }
  const chrome = findChrome()
  if (!chrome) {
    console.error(
      'probe-hydration: no Chrome found. Pass --chrome <path>, or install one of:\n  ' +
        CHROME_CANDIDATES.join('\n  '),
    )
    return 2
  }

  const port = Number(arg('port', '9333'))
  const profile = mkdtempSync(join(tmpdir(), 'theo-probe-'))
  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  )

  const cleanup = async () => {
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
    // Wait for Chrome to actually exit before removing its profile. Measured: removing it while
    // Chrome is still flushing throws ENOTEMPTY from inside `finally`, which REPLACES the return
    // value — a clean run reported exit 1. A probe whose teardown can overwrite its own verdict is
    // worse than one that leaks a temp directory, so the removal is best-effort and the verdict is
    // never allowed to depend on it.
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 3000)
      child.once('exit', () => {
        clearTimeout(done)
        resolve()
      })
    })
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {
      // The profile is a temp directory. Failing to remove it says nothing about the page.
    }
  }

  try {
    const wsUrl = await debuggerUrl(port, 15000)
    if (!wsUrl) {
      console.error('probe-hydration: Chrome started but never opened its debugging port.')
      return 2
    }

    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    const { send, events } = cdp(ws)

    const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
    const { result: attached } = await send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })
    const sid = attached.sessionId

    await send('Runtime.enable', {}, sid)
    await send('Log.enable', {}, sid)
    await send('Page.enable', {}, sid)
    const nav = await send('Page.navigate', { url }, sid)
    // A dead URL is not a clean page. Chrome renders its OWN connection-error document and fires
    // `load` over it, so waiting for the load event alone reports "nothing was thrown" about a page
    // that never existed — the exact failure this probe's exit-2 contract is written to prevent.
    // Measured: pointing at a port nothing listened on returned exit 0, clean.
    if (nav.result?.errorText) {
      console.error(`probe-hydration: ${url} did not load — ${nav.result.errorText}`)
      return 2
    }

    // Hydration happens after load. Waiting on `Page.loadEventFired` alone measures the document,
    // not the client, and the whole point of this probe is what React does AFTER the markup lands.
    const loadedBy = Date.now() + 20000
    let loaded = false
    while (Date.now() < loadedBy && !loaded) {
      loaded = events.some((e) => e.method === 'Page.loadEventFired')
      if (!loaded) await new Promise((r) => setTimeout(r, 150))
    }
    if (!loaded) {
      console.error(`probe-hydration: ${url} never fired a load event within 20s.`)
      return 2
    }
    await new Promise((r) => setTimeout(r, 2500))

    return report(url, events)
  } catch (err) {
    console.error(
      `probe-hydration: could not measure — ${err instanceof Error ? err.message : err}`,
    )
    return 2
  } finally {
    await cleanup()
  }
}

process.exit(await main())
