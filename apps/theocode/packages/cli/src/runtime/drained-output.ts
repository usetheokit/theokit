interface DrainedOutputDeps {
  exit: (code: number) => void
  recordExitCode: (code: number) => void
  setTimer: (fn: () => void, ms: number) => unknown
  unref: (timer: unknown) => void
  capMs: number
}

function createDrainedOutput(deps: DrainedOutputDeps): (code: number) => void {
  return (code: number) => {
    deps.recordExitCode(code)
    const timer = deps.setTimer(() => {
      deps.exit(code)
    }, deps.capMs)
    deps.unref(timer)
  }
}

export function createDrainedProcessOutput(capMs: number): (code: number) => void {
  return createDrainedOutput({
    exit: (c) => {
      process.exit(c)
    },
    recordExitCode: (c) => {
      process.exitCode = c
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    unref: (t) => {
      ;(t as NodeJS.Timeout).unref()
    },
    capMs,
  })
}
