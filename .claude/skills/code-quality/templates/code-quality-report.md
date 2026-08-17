# Code Quality Audit: {slug_or_repo}

**Date:** {date}
**Mode:** {mode}
**Verdict:** {verdict}
**Score cap:** {score_cap}
**Hard caps triggered:** {hard_caps_list}

## Summary

- Languages audited: {languages_audited}
- Languages skipped: {languages_skipped} ({skip_reasons})
- Total findings: {total_findings} ({hard_count} HARD, {soft_cap_count} SOFT_CAP, {soft_floor_count} SOFT_FLOOR, {info_count} INFO)

## Findings by detector

### D1 — Dead code

{d1_findings_table}

### D2 — Symbol fabrication

{d2_findings_table}

### D3 — Cross-package orphan exports

{d3_findings_table}

### D4 — Mutation testing (test quality)

{d4_findings_table}

## Allowlist hits

- Active (within sunset): {active_allowlist_count}
- Expired (re-fired at full severity): {expired_allowlist_count}

## Recommended actions

{recommended_actions}

## Related

- Plan (Mode 2 only): {plan_link}
- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
