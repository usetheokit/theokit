#!/usr/bin/env python3
"""Compute the acceptance verdict from the recorded evidence — never from a claim.

The whole point of this cycle is that `[x]` on a roadmap milestone means a human
could have watched the delivered thing work. So the verdict is derived here,
mechanically, from an evidence record; the agent that ran the journeys does not
get to assert it.

The one rule everything else follows from: **a criterion marked `passed` with no
evidence is not a pass.** It is refused as `NOT_VALIDATED`, which is deliberately
a different verdict from `REJECTED` — "we could not check" and "we checked and it
is broken" are different facts, and collapsing them is how a cycle starts lying.

Evidence record (JSON):

    {"milestone_id": "M2",
     "target": {"kind": "web", "url": "https://app.example.com"},
     "results": [
       {"id": "AC1", "status": "passed",
        "evidence": ["knowledge-base/acceptance/evidence/M2-AC1-checkout.png"],
        "note": "checkout completed, 200 on POST /orders"}
     ],
     "defects": [{"severity": "minor", "summary": "...", "issue": "#412"}]}

`status` ∈ passed | failed | blocked | not_exercised.
`defects[].severity` ∈ blocker | major | minor.

Usage:
    python3 compute_acceptance_verdict.py --criteria criteria.json --evidence evidence.json

Exit codes:
    0 — ACCEPTED or ACCEPTED_WITH_CAVEATS (verdict on stdout)
    1 — REJECTED or NOT_VALIDATED (verdict on stdout, reasons on stderr)
    2 — file not found / malformed input
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

VALID_STATUSES = {"passed", "failed", "blocked", "not_exercised"}
VALID_SEVERITIES = {"blocker", "major", "minor"}

ACCEPTED = "ACCEPTED"
ACCEPTED_WITH_CAVEATS = "ACCEPTED_WITH_CAVEATS"
REJECTED = "REJECTED"
NOT_VALIDATED = "NOT_VALIDATED"

#: Verdicts that allow cycle-roadmap to flip the milestone checkbox to [x].
FLIP_ALLOWED = {ACCEPTED, ACCEPTED_WITH_CAVEATS}


class MalformedEvidence(Exception):
    """The evidence record cannot be interpreted at all."""


def _has_evidence(result: dict) -> bool:
    evidence = result.get("evidence") or []
    if isinstance(evidence, str):
        evidence = [evidence]
    return any(str(item).strip() for item in evidence)


def _validate_shapes(results: list[dict], defects: list[dict]) -> None:
    for result in results:
        if "id" not in result:
            raise MalformedEvidence(f"a result has no `id`: {result!r}")
        status = result.get("status")
        if status not in VALID_STATUSES:
            raise MalformedEvidence(
                f"{result['id']}: status {status!r} is not one of {sorted(VALID_STATUSES)}."
            )
    for defect in defects:
        severity = defect.get("severity")
        if severity not in VALID_SEVERITIES:
            raise MalformedEvidence(
                f"defect severity {severity!r} is not one of {sorted(VALID_SEVERITIES)}."
            )


def compute(criteria: list[dict], results: list[dict], defects: list[dict]) -> dict:
    """Return {verdict, reasons, flip_allowed} for the criteria/evidence pair."""
    _validate_shapes(results, defects)

    by_id = {result["id"]: result for result in results}
    reasons: list[str] = []

    missing = [c["id"] for c in criteria if c["id"] not in by_id]
    unexercised = [
        c["id"]
        for c in criteria
        if by_id.get(c["id"], {}).get("status") in {"not_exercised", "blocked"}
    ]
    unevidenced = [
        c["id"]
        for c in criteria
        if by_id.get(c["id"], {}).get("status") == "passed" and not _has_evidence(by_id[c["id"]])
    ]

    for criterion_id in missing:
        reasons.append(f"{criterion_id}: no result recorded — the criterion was never exercised.")
    for criterion_id in unexercised:
        status = by_id[criterion_id]["status"]
        reasons.append(f"{criterion_id}: {status} — the live system was not exercised for it.")
    for criterion_id in unevidenced:
        reasons.append(
            f"{criterion_id}: marked passed with no evidence — an asserted pass is not a pass."
        )

    if missing or unexercised or unevidenced:
        return {"verdict": NOT_VALIDATED, "reasons": reasons, "flip_allowed": False}

    failed = [c["id"] for c in criteria if by_id[c["id"]]["status"] == "failed"]
    blocker_defects = [d for d in defects if d.get("severity") == "blocker"]

    if failed:
        for criterion_id in failed:
            note = by_id[criterion_id].get("note", "")
            reasons.append(f"{criterion_id}: failed in the live system. {note}".strip())
    for defect in blocker_defects:
        reasons.append(f"blocker defect: {defect.get('summary', '(no summary)')}")

    if failed or blocker_defects:
        return {"verdict": REJECTED, "reasons": reasons, "flip_allowed": False}

    if defects:
        for defect in defects:
            reasons.append(
                f"{defect.get('severity')} defect: {defect.get('summary', '(no summary)')} "
                f"[{defect.get('issue', 'NO ISSUE FILED')}]"
            )
        return {"verdict": ACCEPTED_WITH_CAVEATS, "reasons": reasons, "flip_allowed": True}

    return {
        "verdict": ACCEPTED,
        "reasons": [f"all {len(criteria)} criteria exercised and evidenced in the live system."],
        "flip_allowed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--criteria", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()

    for path in (args.criteria, args.evidence):
        if not path.exists():
            print(f"file not found: {path}", file=sys.stderr)
            return 2

    try:
        criteria_doc = json.loads(args.criteria.read_text(encoding="utf-8"))
        evidence_doc = json.loads(args.evidence.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"malformed JSON: {exc}", file=sys.stderr)
        return 2

    criteria = criteria_doc.get("criteria", [])
    if not criteria:
        print("NOT_VALIDATED cycle-acceptance: no criteria to validate.", file=sys.stderr)
        return 1

    try:
        outcome = compute(criteria, evidence_doc.get("results", []), evidence_doc.get("defects", []))
    except MalformedEvidence as exc:
        print(f"malformed evidence record: {exc}", file=sys.stderr)
        return 2

    print(outcome["verdict"])
    for reason in outcome["reasons"]:
        print(f"  - {reason}", file=sys.stderr)

    return 0 if outcome["flip_allowed"] else 1


if __name__ == "__main__":
    sys.exit(main())
