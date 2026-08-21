#!/usr/bin/env bash
# Metric 4 — time to first green run, both sides, cold.
#
# The hole this closes: the winning rule requires "not worse on time to first green run", and metric
# 4 is unmeasured on every one of the ten journeys — including J9, the one journey reported as won.
#
# What is timed: a clean copy of each side's committed source, with no node_modules and no build
# output, through install -> build -> start -> first successful HTTP response. The npm cache is NOT
# cleared between runs, and that is stated rather than hidden: clearing it measures the registry's
# throughput on this connection more than it measures either framework, and it would be the same
# tax on both sides anyway. Runs are therefore WARM-CACHE and comparable to each other, not to a
# first-ever install on a new machine.
#
# The journey delta is not re-applied. J9's delta is 2 lines against 14; it cannot move a number
# whose unit is tens of seconds, and both sides carry their own already.
# Third lesson, paid on 2026-08-21: the probe follows redirects. J4's Next.js entry route answers
# 307 and sends the browser to a freshly generated thread id; `curl -fsS` without `-L` reads that as
# a failure and the lane reported NEVER_ANSWERED against a server that was serving correctly. A
# redirect to the page the user lands on is a green serve. J7's and J9's lanes answer 200 directly,
# so this changes none of their recorded numbers.
set -u
OUT="$1"; SRC="$2"; LABEL="$3"; PORT="$4"; PROBE="$5"; RUNS="${6:-3}"
WORK="$(dirname "$OUT")/m4-$LABEL"

for i in $(seq 1 "$RUNS"); do
  rm -rf "$WORK"
  mkdir -p "$WORK"
  # Copy the source only — never a previous run's node_modules or build output.
  ( cd "$SRC" && tar --exclude=node_modules --exclude=.next --exclude=.theokit --exclude=dist \
      --exclude='*.log' -cf - . ) | ( cd "$WORK" && tar -xf - ) 2>/dev/null

  start=$(date +%s.%N)
  ( cd "$WORK" && npm install --silent --no-audit --no-fund >/dev/null 2>&1 ) || { echo "$LABEL run$i INSTALL_FAILED" >>"$OUT"; continue; }
  inst=$(date +%s.%N)
  ( cd "$WORK" && npm run build >/dev/null 2>&1 ) || { echo "$LABEL run$i BUILD_FAILED" >>"$OUT"; continue; }
  built=$(date +%s.%N)

  # A distinct port per run, and a pre-flight that the port is free.
  #
  # The first attempt at this harness reused one port across runs and killed the server with a
  # `pkill` pattern that did not match the real command line (`npm exec theokit start --port N`).
  # Run 2 then reported `start=0.0` — the probe had answered from run 1's surviving process. The
  # number was not slow or fast, it was somebody else's. Measuring a target that is still moving is
  # the same defect this repository spent the day finding in its own tests; the instrument is not
  # exempt.
  RUNPORT=$((PORT + i))
  if ss -ltn 2>/dev/null | grep -q ":$RUNPORT "; then
    echo "$LABEL run$i PORT_BUSY_$RUNPORT" >>"$OUT"; continue
  fi
  # Each side is told the port the way that side accepts it, and the asymmetry is the point rather
  # than a workaround: `next start` reads `PORT`; `theokit start` does not read it at all on the
  # published version (the second half of usetheokit/theokit#402, confirmed today, fix unreleased).
  # Passing only `PORT` measured three TheoKit runs as NEVER_ANSWERED — the server was up and
  # listening on 3000 while the probe knocked on the port it had been asked for.
  ( cd "$WORK" && PORT="$RUNPORT" HOST=127.0.0.1 npm run start -- --port "$RUNPORT" >/dev/null 2>&1 & echo $! > "$WORK/.pid" )
  ok=""
  for _ in $(seq 1 180); do
    if curl -fsSL --max-time 2 "http://127.0.0.1:$RUNPORT$PROBE" >/dev/null 2>&1; then ok=1; break; fi
    sleep 0.5
  done
  green=$(date +%s.%N)
  # Kill by the port that is actually listening, not by a guessed command line.
  LPID=$(ss -ltnp 2>/dev/null | grep ":$RUNPORT " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  [ -n "$LPID" ] && kill -9 "$LPID" 2>/dev/null
  [ -f "$WORK/.pid" ] && kill -9 "$(cat "$WORK/.pid")" 2>/dev/null
  sleep 1

  if [ -z "$ok" ]; then echo "$LABEL run$i NEVER_ANSWERED" >>"$OUT"; continue; fi
  printf '%s run%s install=%.1f build=%.1f start=%.1f total=%.1f\n' \
    "$LABEL" "$i" \
    "$(echo "$inst - $start" | bc)" "$(echo "$built - $inst" | bc)" \
    "$(echo "$green - $built" | bc)" "$(echo "$green - $start" | bc)" >>"$OUT"
done
rm -rf "$WORK"
