#!/bin/bash
# Runs the TypeScript example through vitest (the only runner that supports @decorators)
# Usage: bash packages/http-decorators/examples/run-ts.sh
cd "$(dirname "$0")/.." && npx vitest run examples/app.test.ts
