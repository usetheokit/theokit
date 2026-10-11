# 0022: Segregation of duties on `main` comes from independent gates, not a human approver

- Status: Accepted
- Date: 2026-10-07
- Deciders: the repository owner, in the S-001 session (the same decision as theokit-gateways ADR-0004, taken on 2026-10-06)

## Context

Every review of a change that touches CI here runs `loop-delivery-audit`, and its runs return
`INVALID` with two hard caps that no change in this repository can clear:

- `soc2_control_bypassed`: a SOC 2 control (CC8.1, change approval) was bypassed in the evidence
  window, because `main` has no required human reviewer;
- `no_segregation_of_duties`: one identity authored, approved and deployed a production change
  (CC6.3).

Both caps describe how `main` is governed, not the code under review. The audit for sprint S-001's
items on 2026-10-07 says so itself: the run "would be INVALID with or without" the change.

The development process this repository runs under decides the opposite on purpose. Its autonomy
envelope (floor 2) lets the system merge a pull request into `main` once its whole chain passed, and
treats a remote that requires a human reviewer as a violated premise, because a pause addressed to a
person who is not coming is a stopped release.

## Decision

Segregation of duties for a change reaching `main` is provided by gates that are independent of the
author, not by a second human:

- every change passes a review by reviewers that are not its author, plus the required independent
  `loop-*` audits for its domains;
- every plan is approved by a review panel whose seats span model families, with the author excluded;
- the merge happens only when every gate passed, and moving a threshold to pass one is forbidden.

The two caps are dismissed for this repository. Their findings stay in each report and are read as
this recorded decision, not as a defect of the change under review.

<!-- AUDIT-CAP-DISMISSED: loop-delivery-audit: soc2_control_bypassed: change approval on main comes from independent automated gates, not a human approver (this ADR) -->
<!-- AUDIT-CAP-DISMISSED: loop-delivery-audit: no_segregation_of_duties: segregation comes from reviewers and panels that are not the author, not from a second human (this ADR) -->

## Considered options

1. **Dismiss the two caps by this ADR** (chosen). Keeps the autonomous merge the process depends on
   and states where segregation comes from instead.
2. **Require a human approver on `main`.** Rejected: it satisfies the audit, but every release then
   stops at an open pull request waiting for a person.
3. **Stop running `loop-delivery-audit`.** Rejected: its other findings on the CI and release
   pipeline are still worth having on every change that touches them.

## Consequences

- A SOC 2 assessment would read CC6.3 and CC8.1 as met by automated independent review, not by
  human approval. Whoever needs a SOC 2 opinion must accept that model or reopen this decision.
- The review coverage gate reads the two markers above, so a delivery audit whose only blocking caps
  are these two no longer blocks a review here. Any other blocking finding still does.
- Revisit when a human approver joins the project, or when a customer or certification requires
  human change approval.
