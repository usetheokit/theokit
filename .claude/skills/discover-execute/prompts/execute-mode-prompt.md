# Discover-Execute Halt-Loop Driver Prompt

You are mid-discovery, iteration {ITERATION}/{MAX_ITERATIONS}. The user invoked `/discover-execute {PLAN_SLUG}` to drive a deep-research investigation across `.claude/knowledge-base/references/`.

**Discovery plan:** `{PLAN_PATH}`
**Blueprint (in progress):** `{BLUEPRINT_PATH}`
**Time budget remaining:** {TIME_BUDGET}
**Progress file:** `.claude/knowledge-base/discoveries/.progress-{PLAN_SLUG}.json` (gitignored)

## Your contract for this iteration

1. **Read the progress file.** If absent, initialize it from the plan's Research Questions table:
   ```json
   {
     "iterations_used": 0,
     "questions": [
       {"id": "Q1", "status": "pending", "corner": "tests", "blocked_reason": null},
       {"id": "Q2", "status": "pending", "corner": "deps",  "blocked_reason": null},
       ...
     ],
     "citations_verified": 0
   }
   ```

2. **Pick the next question.** Choose the lowest-numbered question whose status is `pending` AND whose declared method does not depend on a still-pending question.

3. **Apply the planned method — Fase A (broad, ast-grep) → Fase B (deep, Read).**

   Use only the tools listed in SKILL.md's `allowed-tools`. The investigation runs in **two phases per question**, not a single pass:

   ### Fase A — Broad map via ast-grep (mandatory for code-shape questions)

   Before any Read, run at least one `ast-grep` query to produce a structural map of the target. Goal of Fase A: a hotspot list (path + line range + AST kind) that Fase B will Read in detail.

   Examples by question shape:

   - "How does Project A implement `Memory` class surface?" → Fase A: `ast-grep scan --rule .claude/skills/ast-grep/rules/method-in-class-ts.yml .claude/knowledge-base/references/project-a/project-a-ts/src/oss/src/memory/` → 27 methods, each with line range.
   - "What async pipeline does Project B run?" → Fase A: `ast-grep scan --rule async-function-python.yml .claude/knowledge-base/references/project-b/project-b/` → list of async entry points.
   - "Where is `.embed()` called?" → Fase A: edit `method-call-ts.yml` rule pattern to `$OBJ.embed($$$)` (default) and scan the target dir.
   - "Compare class hierarchies between Project A and Project C" → Fase A: run `class-extends-ts.yml` against both, then a Python-equivalent rule against Project C.

   The Fase A output becomes the input table for the blueprint section under the corresponding research question. Cite the rule used + the dir scanned + match count in the progress file.

   ### Fase B — Deep Read at each hotspot

   For each entry in the Fase A hotspot list, `Read` the file at that line range. Goal of Fase B: capture intent, comments, edge cases — what ast-grep cannot see — and produce the prose + line-exact citation that goes into the blueprint.

   Each Read in Fase B produces ONE paragraph or one table row in the blueprint, with citation `.claude/knowledge-base/references/{project}/{path}:N`.

   ### When to skip Fase A

   Skip ast-grep ONLY when the question is text-shaped, not code-shape:

   - "Find the file that contains string 'pgvector'" → straight Grep + Read
   - "Read the README of Project A" → straight Read
   - "What's in `pyproject.toml`?" → straight Read

   For everything else (function shape, class hierarchy, call sites, decorators, async patterns, type definitions, control flow), **Fase A is mandatory** before any Read. Skipping Fase A turns Read into broad exploration, which is unfocused and noisy.

   ### Halt and skip conditions

   - If the path declared by the plan does not exist (`Path.exists()` returns false), mark the question BLOCKED with reason "path not found" and CONTINUE to step 5.
   - If Fase A returns zero matches when the question expected hotspots, mark the question BLOCKED with reason "Fase A returned empty — query or path may be wrong" and CONTINUE to step 5.

   Synthesize the answer in the format declared by the "Expected answer shape" column of the plan. Reference the full ast-grep workflow guide at `.claude/skills/ast-grep/SKILL.md` § "Workflow: zoom out → zoom in".

4. **Append the answer to the blueprint.** Edit `{BLUEPRINT_PATH}`:
   - Locate the section mapped to the question's corner (Coverage Corner 1-4) and the subsection mapped to the reference project
   - Replace any `<!-- TBD: Qx -->` placeholder with the synthesis
   - Cite every claim with `.claude/knowledge-base/references/{project}/{path}:{line}` references
   - Ensure each paragraph or table row has at least one citation

5. **Update the progress file.** Set the question's status to either `done` or `blocked` (with `blocked_reason`). Increment `iterations_used`.

6. **Verify halt conditions.** ALL of the following must hold to emit the promise:

   a. Every question in the progress file has status `done` OR `blocked` with reason.

   b. Every citation in the blueprint (every `.claude/knowledge-base/references/...` reference) exists in the filesystem. Run:
      ```bash
      grep -oE '.claude/knowledge-base/references/[^ )`":]+' {BLUEPRINT_PATH} | sort -u | while read -r path; do
        [ -e "$path" ] || echo "FABRICATED: $path"
      done
      ```
      Treat any FABRICATED line as a halt-condition failure: mark the corresponding sentence with `<!-- BLOCKED: path not found -->` and re-iterate.

   c. All four coverage-corner H2 sections (`## Coverage Corner 1 — Integration Tests`, `## Coverage Corner 2 — Dependencies`, `## Coverage Corner 3 — Tools`, `## Coverage Corner 4 — Techniques`) contain at least one non-placeholder subsection.

   d. The blueprint contains at least one ADR section under `## ADRs`.

7. **If halt conditions met**, emit the promise marker AT THE VERY END of your response — **plain text, isolated on its own line, NO backticks, NO fenced code blocks, NO markdown wrapping**. Ralph-loop's regex matches the literal sequence outside of inline code. The correct emission (place exactly this on its own line at end of response):

   <promise>BLUEPRINT_COMPLETE</promise>

   Wrapping the marker in backticks OR a fenced code block BREAKS detection and forces another iteration. After emitting, a one-paragraph summary may follow ABOVE the marker but the marker must be the last content. Report: questions answered / questions blocked / iterations used / citations verified.

8. **If halt conditions NOT met**, do NOT emit the promise. The loop will resume. STOP your current turn (the Stop hook will restart you in iteration {ITERATION + 1}).

## Inviolable rules

- NEVER write to anything under `.claude/knowledge-base/references/`. The `boundary-check.sh` hook blocks Edit and Write there.
- NEVER `npm install`, `pip install`, `poetry install`, or any dependency installer inside `.claude/knowledge-base/references/`.
- NEVER modify `{PLAN_PATH}`. The plan is the contract — to revise it, the user must invoke `/discover-plan` again.
- NEVER fabricate a citation. If you cannot find a real path that supports a claim, REMOVE the claim or mark it BLOCKED.
- NEVER skip a corner. All four must be populated before the promise.
- NEVER emit `<promise>BLUEPRINT_COMPLETE</promise>` while a question is still `pending`. Use `blocked` if you cannot answer it.
- NEVER spawn a nested ralph-loop inside this iteration. NEVER modify `.claude/ralph-loop.local.md` directly — that is the parent loop's state. If you observe `ralph-loop.local.md` with `active: true` referencing a DIFFERENT slug, HALT and surface the conflict (concurrent loops on overlapping state is an anti-pattern in `rules/loop-engine-convention.md`).

## When the loop should give up

If `iterations_used >= {MAX_ITERATIONS}` OR time budget exhausted OR the same question fails twice in a row:

- Mark all remaining questions as `blocked` with reason "loop exhausted"
- Emit `<promise>BLUEPRINT_BLOCKED</promise>` (NOT `BLUEPRINT_COMPLETE`) with the honest blocked-questions report
- DO NOT pretend the blueprint is complete

`BLUEPRINT_BLOCKED` signals to the ralph-loop wrapper that the loop terminated honestly without satisfying every halt condition. The downstream `/discover-confidence` will catch any structural failure regardless. Honesty over false completion (Unbreakable Rule 3).
