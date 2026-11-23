#!/bin/bash
# tools/capture-drawn-default.sh — st-ndw9.21 captures, on the Mac mini through gpu2 (never the laptop).
# The default desktop page (the bigger map) now draws the building presets inside the downtown frame and keeps its boxes
# outside it; ?presets=0 is the old look (no massing, no presets files: the page as it was).
# One job a call (the mini takes one at a time): JOB = cost2 | prof | gpu | cost | edge | compare | loads | parity | smoke   (several, space separated, run in order)
#   cost    A ?presets=0 against B the default page, five alternating pairs, uncapped, on tools/shots/drawn-default-cost.json
#           (Cabbagetown, Queen West at Augusta, the Financial District from 300 m, St. James Town, a place outside the frame)
#   edge    four places on the downtown frame's edge from 150 m up and from the street, A then B (frames to look at)
#   loads   twenty repeat loads of the default page: each leaves its console log (the [presets] drawn: line, any page error)
#   parity  phone (default, and with ?quality=low) and desktop ?map=detail request lists and frames, dist-main against dist,
#           main twice and this branch twice, alternating (dist-main/ is a build of origin/main)
#   smoke   one default load and one shot, to see that it works
#
# usage (from the worktree, with dist/ built from this branch and dist-main/ from origin/main):
#   GPU2_LOCK_WAIT=7200 ~/.local/bin/gpu2-local r3-fence -- env CAPTURE_PORT=8843 CAPTURE_CDN_CACHE=1 \
#     CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 JOB=cost TAG=d1- bash tools/capture-drawn-default.sh
set -u
TAG=${TAG:-d-}
SH=tools/shots
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
PH="CAPTURE_DPR=2.625 CAPTURE_MOBILE=1"
RB="CAPTURE_INIT_SCRIPT=tools/capture-resource-buffer.js CAPTURE_REQUEST_LOG=1" # (the server's complete request list: <tag>requests.json)
run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp $shots) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
for J in $JOB; do
case "$J" in
  smoke)
    run dist "?$BASEQ" "${TAG}smoke-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=3000 $RB ;;
  cost)
    for i in 1 2 3 4 5; do
      run dist "?presets=0&$BASEQ" "${TAG}A${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 $RB
      run dist "?$BASEQ"           "${TAG}B${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 $RB
    done ;;
  edge)
    run dist "?presets=0&$BASEQ" "${TAG}edgeA-" 1600x900 $SH/drawn-default-edge.json
    run dist "?$BASEQ"           "${TAG}edgeB-" 1600x900 $SH/drawn-default-edge.json ;;
  compare)
    # the same three places by day and night: the old look (presets=0), the default page, and the detail map's massing page
    run dist "?presets=0&$BASEQ"          "${TAG}cmpA-" 1600x900 $SH/drawn-default-compare.json
    run dist "?$BASEQ"                    "${TAG}cmpB-" 1600x900 $SH/drawn-default-compare.json
    run dist "?map=detail&massing=1&$BASEQ" "${TAG}cmpC-" 1600x900 $SH/drawn-default-compare.json
    run dist "?presets=debug&$BASEQ"      "${TAG}cmpD-" 1600x900 $SH/drawn-default-compare.json ;;
  cost2)
    # st-ndw9.21 cause hunt: six arms, five alternating rounds, four downtown shots, uncapped, with a scene census after each
    #   D0 detail map boxes, D1 detail ?massing=1&presets=0 (outlines), D2 detail ?massing=1 (outlines + presets),
    #   E0 bigger map ?presets=0 (boxes), E1 bigger ?massing=1&presets=0 (outlines), E2 bigger default (outlines + presets)
    for i in 1 2 3 4 5; do
      for spec in "D0:map=detail" "D1:map=detail&massing=1&presets=0" "D2:map=detail&massing=1" "E0:presets=0" "E1:massing=1&presets=0" "E2:"; do
        t=${spec%%:*}; x=${spec#*:}
        run dist "?${x}${x:+&}$BASEQ" "${TAG}${t}${i}-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
      done
    done ;;
  cost3)
    # the same table for the two bigger-map arms only (after a fix): E0 ?presets=0, E2 the default, five alternating rounds
    for i in 1 2 3 4 5; do
      for spec in "E0:presets=0" "E2:"; do
        t=${spec%%:*}; x=${spec#*:}
        run dist "?${x}${x:+&}$BASEQ" "${TAG}${t}${i}-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
      done
    done ;;
  scale)
    # CPU or GPU: the same arms at a tenth of the pixels (?scale=0.4). A difference that stays is geometry (vertex, shadow, submission); one that goes is pixels
    for i in 1 2 3; do
      for spec in "D0:map=detail" "D2:map=detail&massing=1" "E0:presets=0" "E2:"; do
        t=${spec%%:*}; x=${spec#*:}
        run dist "?${x}${x:+&}scale=0.4&$BASEQ" "${TAG}${t}${i}-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1
      done
    done ;;
  probe)
    # where the frame goes: in one page, median frame ms with the sun shadow off, the stand-ins hidden, the massing meshes hidden, all buildings hidden
    for i in 1 2 3; do
      for spec in "D0:map=detail" "D2:map=detail&massing=1" "E0:presets=0" "E2:"; do
        t=${spec%%:*}; x=${spec#*:}
        run dist "?${x}${x:+&}$BASEQ" "${TAG}${t}${i}-" 1600x900 $SH/drawn-probe.json CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=0
      done
    done ;;
  tris)
    # visible triangles by mesh name, boxes arm against the default, two shots
    for spec in "E0:presets=0" "E2:" "D2:map=detail&massing=1" "D1:map=detail&massing=1&presets=0"; do
      t=${spec%%:*}; x=${spec#*:}
      run dist "?${x}${x:+&}$BASEQ" "${TAG}${t}-" 1600x900 $SH/drawn-tris.json CAPTURE_METRICS_MS=0
    done ;;
  ba)
    # before (dist-before/, the build of the branch before the st-ndw9.21 cause fixes) and after (dist/), bigger map, boxes (?presets=0) and the default
    for i in $(seq 1 ${N:-5}); do
      run dist-before "?presets=0&$BASEQ" "${TAG}B0${i}-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
      run dist-before "?$BASEQ"           "${TAG}B2${i}-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
      run dist        "?presets=0&$BASEQ" "${TAG}A0${i}-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
      run dist        "?$BASEQ"           "${TAG}A2${i}-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
    done ;;
  tiers)
    run dist "?$BASEQ" "${TAG}E2-" 1600x900 $SH/drawn-tiers.json CAPTURE_METRICS_MS=0 ;;
  ck)
    # one round of the default and the boxes page on dist/, with the census
    run dist "?$BASEQ" "${TAG}E2-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
    run dist "?presets=0&$BASEQ" "${TAG}E0-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
    run dist "?$BASEQ" "${TAG}T-" 1600x900 $SH/drawn-tris.json CAPTURE_METRICS_MS=0 ;;
  look)
    # side-by-side material: the same shots before (dist-before/) and after (dist/): the five places, 150 m and 400 m up, a bike along two streets
    for arm in dist-before dist; do
      t=${arm#dist}; t=${t:-after}; t=${t#-}
      run $arm "?$BASEQ" "${TAG}${t}-five-" 1600x900 $SH/drawn-cost2.json CAPTURE_METRICS_MS=0
      run $arm "?$BASEQ" "${TAG}${t}-air-" 1600x900 $SH/drawn-air.json CAPTURE_METRICS_MS=0
      run $arm "?$BASEQ" "${TAG}${t}-bike-" 1600x900 $SH/drawn-bike.json CAPTURE_METRICS_MS=0
    done ;;
  ba5)
    # the final table: the five places (drawn-default-cost.json), before (dist-before/) and after (dist/), boxes and default, N alternating rounds
    for i in $(seq 1 ${N:-5}); do
      run dist-before "?presets=0&$BASEQ" "${TAG}B0${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
      run dist-before "?$BASEQ"           "${TAG}B2${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
      run dist        "?presets=0&$BASEQ" "${TAG}A0${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
      run dist        "?$BASEQ"           "${TAG}A2${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
    done ;;
  after5)
    # the final build only: the boxes page and the default, N alternating rounds on the five places (the before arms are ba5's)
    for i in $(seq 1 ${N:-5}); do
      run dist "?presets=0&$BASEQ" "${TAG}A0${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
      run dist "?$BASEQ"           "${TAG}A2${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 $RB
    done ;;
  gpu)
    # per-pass GPU time (?gputime=1: timestamp queries), uncapped, three rounds of the four arms on two shots
    for i in 1 2 3; do
      for spec in "D0:map=detail" "D2:map=detail&massing=1" "E0:presets=0" "E2:"; do
        t=${spec%%:*}; x=${spec#*:}
        run dist "?${x}${x:+&}gputime=1&$BASEQ" "${TAG}${t}${i}-" 1600x900 $SH/drawn-gpu.json CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=0
      done
    done ;;
  loadprof)
    # inclusive-time profiles of the load, bigger map default and boxes, twice each
    PO=${GPU2_OUT:-capture-out}
    for i in 1 2; do
      for spec in "E2:" "E0:presets=0"; do
        t=${spec%%:*}; x=${spec#*:}
        run dist "?${x}${x:+&}$BASEQ" "${TAG}${t}${i}-" 1600x900 $SH/drawn-default-load.json CAPTURE_PROFILE=1 CAPTURE_METRICS_MS=0
        [ -f $PO/profile-inclusive.txt ] && mv $PO/profile-inclusive.txt "$PO/${TAG}${t}${i}-loadincl.txt"
        [ -f $PO/profile.txt ] && mv $PO/profile.txt "$PO/${TAG}${t}${i}-loadself.txt"
      done
    done ;;
  prof)
    # CPU profiles (self time) of the frame loop on two shots, and of the load: E0 ?presets=0, E2 default, D2 detail massing, D0 detail boxes
    PO=${GPU2_OUT:-capture-out}
    for spec in "E0:presets=0" "E2:" "D2:map=detail&massing=1" "D0:map=detail"; do
      t=${spec%%:*}; x=${spec#*:}
      for sh in cabbagetown financial300; do
        run dist "?${x}${x:+&}$BASEQ" "${TAG}${t}-${sh}-" 1600x900 $SH/drawn-prof-$sh.json CAPTURE_PROFILE=shots CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=0
        [ -f $PO/profile.txt ] && mv $PO/profile.txt "$PO/${TAG}${t}-${sh}-frameprofile.txt"
      done
      run dist "?${x}${x:+&}$BASEQ" "${TAG}${t}-load-" 1600x900 $SH/drawn-default-load.json CAPTURE_PROFILE=1 CAPTURE_METRICS_MS=0
      [ -f $PO/profile.txt ] && mv $PO/profile.txt "$PO/${TAG}${t}-loadprofile.txt"
    done ;;
  loads)
    for i in $(seq 1 20); do
      run dist "?$BASEQ" "${TAG}L$(printf %02d $i)-" 1600x900 $SH/drawn-default-load.json
    done ;;
  parity)
    for spec in "phone:?$BASEQ" "phonelow:?quality=low&$BASEQ"; do
      t=${spec%%:*}; q=${spec#*:}
      for i in 1 2; do
        run dist-main "$q" "${TAG}${t}-M${i}-" 412x915 $SH/building-presets-parity.json $RB $PH
        run dist      "$q" "${TAG}${t}-B${i}-" 412x915 $SH/building-presets-parity.json $RB $PH
      done
    done
    for spec in "detail:?map=detail&$BASEQ" "detailmassing:?map=detail&massing=1&$BASEQ" "off:?presets=0&$BASEQ"; do
      t=${spec%%:*}; q=${spec#*:}
      for i in 1 2; do
        run dist-main "$q" "${TAG}${t}-M${i}-" 1600x900 $SH/building-presets-parity.json $RB
        run dist      "$q" "${TAG}${t}-B${i}-" 1600x900 $SH/building-presets-parity.json $RB
      done
    done
    # (the other presets pages keep working: the gallery, and the debug paint on the detail map; one load each, with the console)
    run dist "?gallery=presets&$BASEQ"                    "${TAG}gallery-"     1600x900 $SH/drawn-default-load.json $RB
    run dist "?map=detail&massing=1&presets=debug&$BASEQ" "${TAG}detaildebug-" 1600x900 $SH/drawn-default-load.json $RB
    run dist "?presets=0&$BASEQ"                          "${TAG}offload-"     1600x900 $SH/drawn-default-load.json $RB ;;
  standins)
    # st-ndw9.22: the shadow stand-ins' triangles by source, two shots (dist/ or ROOT=...)
    for r in ${SROOTS:-${ROOTS:-dist}}; do
      run $r "?$BASEQ" "${TAG}${r}-standins-" 1600x900 $SH/drawn-standins.json CAPTURE_METRICS_MS=0
    done ;;
  loadprof2)
    # st-ndw9.22: inclusive load profiles with 500 lines (where the load goes, by function), N times each:
    #   LPARMS="boxes|dist-main|presets=0 main|dist-main| final|dist-final2|" (tag|build folder|query without the common part)
    PO=${GPU2_OUT:-capture-out}
    for i in $(seq 1 ${N:-2}); do
      for arm in ${LPARMS:-default|${ROOT:-dist}|}; do
        t=${arm%%|*}; r=${arm#*|}; x=${r#*|}; r=${r%%|*}
        run $r "?${x}${x:+&}$BASEQ" "${TAG}lp-${t}${i}-" 1600x900 $SH/drawn-default-load.json CAPTURE_PROFILE=1 CAPTURE_PROFILE_TOP=500 CAPTURE_METRICS_MS=0
        [ -f $PO/profile-inclusive.txt ] && mv $PO/profile-inclusive.txt "$PO/${TAG}lp-${t}${i}-loadincl.txt"
        [ -f $PO/profile.txt ] && mv $PO/profile.txt "$PO/${TAG}lp-${t}${i}-loadself.txt"
      done
    done ;;
  probe2)
    # where the frame goes by mesh class, in one page: median frame ms with each class hidden (PARMS="tag|build|query ...")
    for i in $(seq 1 ${N:-3}); do
      for arm in ${PARMS:-final|dist|}; do
        t=${arm%%|*}; r=${arm#*|}; x=${r#*|}; r=${r%%|*}
        run $r "?${x}${x:+&}$BASEQ" "${TAG}${t}${i}-" 1600x900 $SH/drawn-probe2.json CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=0
      done
    done ;;
  viewtris)
    # triangles the main camera really draws by mesh class (inside its frustum), the builds and queries of PARMS="tag|build|query ..."
    for arm in ${PARMS:-final|dist|}; do
      t=${arm%%|*}; r=${arm#*|}; x=${r#*|}; r=${r%%|*}
      run $r "?${x}${x:+&}$BASEQ" "${TAG}${t}-" 1600x900 $SH/drawn-viewtris.json CAPTURE_METRICS_MS=0
    done ;;
  patios)
    # st-ndw9.23: the patio layout the drawn-buildings page computes (the dump tools/build-patios.mjs records; --frame eglinton-drawn),
    # and the stats of the default page's own prebuilt layout (ROOT=dist: stale or not)
    run ${ROOT:-dist-main} "?patios=layout&$BASEQ" "${TAG}patios-" 1600x900 $SH/patio-layout.json CAPTURE_METRICS_MS=0 ;;
  patiostats)
    # which patio layout the page used (prebuilt or runtime) and whether its fingerprint held, default page, ?presets=0, ?map=detail, ?massing=1&map=detail
    for q in "" "presets=0" "map=detail" "map=detail&massing=1" "map=eglinton&quality=low"; do
      run ${ROOT:-dist} "?${q}${q:+&}$BASEQ" "${TAG}ps-${q//[^a-z0-9]/_}-" 1600x900 $SH/drawn-patiostats.json CAPTURE_METRICS_MS=0
    done ;;
  shadows)
    # golden-hour ground shadows on house streets and tower blocks, the builds of ROOTS, side by side afterwards
    for r in ${HROOTS:-${ROOTS:-dist}}; do run $r "?$BASEQ" "${TAG}${r}-" 1600x900 $SH/drawn-shadows.json CAPTURE_METRICS_MS=0; done ;;
  bands)
    for r in ${BROOTS:-${ROOTS:-dist}}; do run $r "?$BASEQ" "${TAG}${r}-" 1600x900 $SH/drawn-bands.json CAPTURE_METRICS_MS=0; done ;;
  patioframes)
    run dist-main "?$BASEQ" "${TAG}main-" 1600x900 $SH/drawn-patios.json CAPTURE_METRICS_MS=0
    run dist "?$BASEQ" "${TAG}final-" 1600x900 $SH/drawn-patios.json CAPTURE_METRICS_MS=0
    run dist "?presets=0&$BASEQ" "${TAG}boxes-" 1600x900 $SH/drawn-patios.json CAPTURE_METRICS_MS=0 ;;
  look2)
    # the bike sequences and the aerials, main and the build (ROOTS), for the pairs
    for r in ${LROOTS:-${ROOTS:-dist}}; do
      run $r "?$BASEQ" "${TAG}${r}-air-" 1600x900 $SH/drawn-air.json CAPTURE_METRICS_MS=0
      run $r "?$BASEQ" "${TAG}${r}-bike-" 1600x900 $SH/drawn-bike.json CAPTURE_METRICS_MS=0
    done ;;
  parity2)
    # the phone, the phone's low tier, ?map=detail and ?presets=0: request lists and one frame each, main twice and the build twice
    for spec in "phone:?$BASEQ:412x915" "phonelow:?quality=low&$BASEQ:412x915" "detail:?map=detail&$BASEQ:1600x900" "off:?presets=0&$BASEQ:1600x900"; do
      t=${spec%%:*}; rest=${spec#*:}; vp=${rest##*:}; q=${rest%:*}
      extra=""; [ "$vp" = "412x915" ] && extra="$PH"
      for i in 1 2; do
        run dist-main "$q" "${TAG}${t}-M${i}-" $vp $SH/building-presets-parity.json $RB $extra
        run dist      "$q" "${TAG}${t}-B${i}-" $vp $SH/building-presets-parity.json $RB $extra
      done
    done ;;
  arms)
    # st-ndw9.22: any set of builds against each other, N alternating rounds, the five places, uncapped.
    #   ARMS="M|dist-main|  A0|dist-main|presets=0  S1|dist-s1|" (tag|build folder|query, without the common part)
    for i in $(seq 1 ${N:-5}); do
      for arm in $ARMS; do
        t=${arm%%|*}; r=${arm#*|}; x=${r#*|}; r=${r%%|*}
        run "$r" "?${x}${x:+&}$BASEQ" "${TAG}${t}${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=5000 CAPTURE_UNCAPPED=1 CAPTURE_KEEP_GOING=1 $RB
      done
    done ;;
  *) echo "unknown JOB $J"; exit 2 ;;
esac
done
echo "=== done $JOB ==="
