---
'@theokit/agents': patch
---

`loadMcpServersFile` reads the `mcpServers` member of a document that holds other keys, accepts a remote entry with OAuth `auth` when the installed `@theokit/sdk` supports it, and takes an `options.readFile` in place of the disk read.
