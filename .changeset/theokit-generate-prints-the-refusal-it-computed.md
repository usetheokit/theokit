---
"theokit": patch
---

`theokit generate` now prints the reason it refused a name. A schedule whose `agentsDir` resolves outside the project prints `Path traversal denied: "<path>" is outside the project root <root>.`, and a reserved name such as `constructor` prints the `Reserved name` message; both used to print `Invalid name "<name>". Use kebab-case ...` for a name that was valid kebab-case. A name that is not kebab-case still prints that message. (B-411)
