---
generated_by: roadmap-init
generated_on: {{DATE}}
slug: {{SLUG}}
peer_count_cloned: {{N_CLONED}}
peer_count_skipped: {{N_SKIPPED}}
---

# References catalog

State-of-the-art peer projects gathered at project inception by `/roadmap-init`.
This file is the contract `/discover-plan` reads when investigating a peer.

> **Lifecycle:** every peer below has lifecycle `cloned` (folder present under this directory) or `skipped` (rejected at license gate, kept here for the record).

---

## {{PEER_1_NAME}}

- **Folder:** `knowledge-base/references/{{PEER_1_FOLDER}}/`
- **Lifecycle:** {{cloned | skipped}}
- **Repo:** {{PEER_1_REPO_URL}}
- **License:** `{{PEER_1_SPDX}}`
- **License-gate decision:** {{clone-anyway-study-only | auto-approved-permissive | skipped}}
- **Last release / last commit:** {{PEER_1_LAST_RELEASE_DATE}}
- **Stars / forks at clone time:** {{PEER_1_STARS}} / {{PEER_1_FORKS}}

### Why this peer is here

{{PEER_1_MOTIVATION_FROM_GRILL_ANSWERS}}

### What to study in it

- {{STUDY_ITEM_1}}
- {{STUDY_ITEM_2}}
- {{STUDY_ITEM_3}}

### Supports ROADMAP milestone(s)

- {{MILESTONE_ID_1}} — *because:* {{LINK_REASON_1}}
- {{MILESTONE_ID_2}} — *because:* {{LINK_REASON_2}}

### Clone command used

```bash
git clone --depth 1 --filter=blob:none {{PEER_1_REPO_URL}} knowledge-base/references/{{PEER_1_FOLDER}}/
```

---

## {{PEER_2_NAME}}

(same shape as PEER_1)

---

## {{PEER_3_NAME}}

(same shape)

---

<!-- Repeat per peer. Cap at 8 cloned peers. -->

---

## Skipped peers (license gate)

> Peers identified during SOTA discovery but rejected at the license gate.
> Listed here so the decision is auditable and not repeated next time.

| Peer | Repo | License | Reason for skip |
|---|---|---|---|
| {{SKIPPED_1}} | {{URL}} | {{LICENSE}} | {{REASON}} |
| {{SKIPPED_2}} | {{URL}} | {{LICENSE}} | {{REASON}} |

---

## Cleanup protocol

- **Remove a peer:** delete its folder under this directory AND remove its entry from this catalog in the same commit.
- **Update a peer (refresh clone):** `cd knowledge-base/references/{{peer}}/ && git pull` — record the new commit SHA in this catalog.
- **Replace a peer with a better one:** treat as remove + add. Do NOT rename folders; symbolic continuity is meaningless when the underlying repo changed.
