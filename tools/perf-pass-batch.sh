#!/bin/bash
# tools/perf-pass-batch.sh — several tools/capture.mjs runs back to back inside ONE gpu2 lock, for paired A/B arms
# (docs/perf-pass-coo.md). Usage, on the mini through gpu2 (the CAPTURE_* settings go in gpu2's `env` part):
#   gpu2 <name> -- env CAPTURE_ROOT=dist ... bash tools/perf-pass-batch.sh tools/shots/perf-pass-views.json \
#     d1-base='?quality=high&...' d1-clouds0='?quality=high&...&clouds=0' ...
# Each <tag>=<query> argument is one fresh browser load: CAPTURE_TAG=<tag>, CAPTURE_QUERY=<query>. A run whose page
# fails to load is retried once. Order is kept as given, so arms can be interleaved with the base. An argument
# <dir>|<tag>=<query> serves that arm from <dir> instead of $CAPTURE_ROOT (two builds A/B'd in one batch).
shots=$1; shift
for arm in "$@"; do
  root=${CAPTURE_ROOT:-.}; case $arm in *'|'*) root=${arm%%|*}; arm=${arm#*|};; esac
  tag=${arm%%=*}; q=${arm#*=}
  echo "[batch] $(date -u +%FT%TZ) $tag root=$root $q"
  CAPTURE_ROOT=$root CAPTURE_TAG=$tag CAPTURE_QUERY=$q node ${CAPTURE_SCRIPT:-tools/capture.mjs} "$shots" \
    || { echo "[batch] $tag failed; retrying once"; sleep 5; CAPTURE_ROOT=$root CAPTURE_TAG=$tag CAPTURE_QUERY=$q node ${CAPTURE_SCRIPT:-tools/capture.mjs} "$shots"; } \
    || echo "[batch] $tag FAILED twice"
done
echo "[batch] $(date -u +%FT%TZ) done"
