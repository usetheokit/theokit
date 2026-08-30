---
'theokit': patch
---

A provider whose catalog says it needs no credential no longer demands one.

#579 opened the SDK's 45 builtins to a model id, and derived the credential env var from
`profile.envVars[0]` whenever that array was non-empty — treating *"an env var is named"* as *"a key
is required"*. Those are different claims, and `authType` answers the second. The SDK declares both
on the same profile:

```
{ name: 'lmstudio', envVars: ['LMSTUDIO_API_KEY'], authType: 'none' }
```

so a local model server was refused for want of a variable with nothing behind it — and setting it
to any string satisfied the gate, because there is nothing to authenticate against (#585). Three of
the 45 builtins are in that class: `ollama`, `lmstudio`, `llamacpp`. `ollama` escaped only because
this project's own registry entry wins before the plugin path is reached, which is why #407's
keyless handling did not cover the other two — it was written for a registry of four.

`envVars[0]` remains the credential whenever the profile actually authenticates by one, and a
profile carrying no `authType` keeps the previous rule and requires the named variable: reading an
absent field as "keyless" would be the permissive reading of a silence.
