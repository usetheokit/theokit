---
'@theokit/agents': patch
---

`runAgentEvals` hands the SDK eval runner an adapter that exposes only the bridge's typed `send`, instead of casting the whole `SdkAgentHandle`; verdicts and disposal are unchanged.
