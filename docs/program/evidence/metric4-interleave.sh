#!/usr/bin/env bash
# Interleaved driver over metric4-harness.sh.
# The harness times ONE lane per invocation; the protocol requires the two lanes to alternate run by
# run so machine drift falls on both columns. This calls the harness with RUNS=1, alternating, with a
# distinct port per invocation. The harness itself is unmodified apart from the redirect-following
# probe documented in its header.
set -u
H=/home/paulo/Projetos/theo/theokit-framework/theokit/docs/program/evidence/metric4-harness.sh
OUT="$1"; TK="$2"; NX="$3"; TKPROBE="$4"; NXPROBE="$5"; RUNS="${6:-3}"; TAG="${7:-j}"
for r in $(seq 1 "$RUNS"); do
  bash "$H" "$OUT" "$TK" "$TAG-theokit-r$r" $((5100 + r * 2)) "$TKPROBE" 1
  bash "$H" "$OUT" "$NX" "$TAG-nextjs-r$r"  $((5200 + r * 2)) "$NXPROBE" 1
done
