#!/bin/bash
# Roda o example TypeScript via vitest (único runner que suporta @decorators)
# Usage: bash packages/http-decorators/examples/run-ts.sh
cd "$(dirname "$0")/.." && npx vitest run examples/app.test.ts
