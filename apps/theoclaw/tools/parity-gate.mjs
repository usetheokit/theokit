#!/usr/bin/env node
import { runGate } from './parity/gate.mjs'

process.exitCode = runGate(process.argv.slice(2).filter((arg) => arg !== '--'))
