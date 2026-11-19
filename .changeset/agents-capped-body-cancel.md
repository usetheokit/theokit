---
"@theokit/agents": patch
---

Reading a request body past its size cap no longer waits on, or fails with, the stream's cancel: a cancel that rejects or never settles still ends in the 413 answer.
