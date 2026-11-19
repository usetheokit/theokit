# createACPTool

`createACPTool` (from `theokit/server/agent`) wraps a coding agent (Claude Code, Codex, Gemini CLI) that speaks ACP over stdio as a tool.

## How the command is resolved

`command` is resolved by `resolveAgentCommand` before anything is spawned:

- A command with a `/` must be an absolute path to an executable file. `./bin/agent` and `bin/agent` are refused.
- A bare name is searched only on the absolute entries of `PATH` (`env.PATH` when `env` is given, else `process.env.PATH`). Empty, `.` and relative entries are skipped, so a copy in the agent's working directory is never run.
- The agent's own `PATH` is those absolute entries only.
- A command that does not resolve closes the transport at once with `AcpTransportClosedError` (`could not be found or run ...`), and no process is spawned.

On Windows the command is passed to the spawn as given; `PATHEXT` lookup is not done.
