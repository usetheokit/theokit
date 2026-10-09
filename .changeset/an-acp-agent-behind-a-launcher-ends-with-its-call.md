---
"theokit": patch
---

An ACP agent started through a launcher no longer outlives the call. `NodeAcpTransport` signalled only the process it spawned, so when the configured command was a launcher (`npx`, `pnpm dlx`, a shell script), closing ended the launcher and left the real agent running, orphaned, after the call returned. On Linux and macOS the agent now runs in its own process group, and closing sends SIGTERM and then SIGKILL to the whole group and waits until every process in it has exited. On Windows the transport still signals only the spawned process. (B-408)
