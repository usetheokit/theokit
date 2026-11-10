import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { stopProcessGroup } from './stop-process-group.js'

it('stops a parent and its child so the directory they write into can be removed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'theoclaw-group-'))
  const childCode = `const fs=require('fs');let i=0;setInterval(()=>fs.writeFileSync(${JSON.stringify(directory)}+'/f'+(i++),'x'),2)`
  const parentCode = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});setInterval(()=>{},1000)`
  const parent = spawn(process.execPath, ['-e', parentCode], { detached: true, stdio: 'ignore' })
  const deadline = Date.now() + 10_000
  while (readdirSync(directory).length < 3 && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20))
  expect(readdirSync(directory).length).toBeGreaterThanOrEqual(3)

  await stopProcessGroup(parent)
  rmSync(directory, { recursive: true })
  expect(existsSync(directory)).toBe(false)
})
