---
'@theocode/cli': patch
---

Headless `exec` gives each tool call its own item id, completes a failed call as `failed` and prints a failure line, and keeps the tool name on the completed item.
