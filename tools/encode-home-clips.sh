#!/bin/bash
# tools/encode-home-clips.sh: turns tools/render-film.mjs's render of tools/shots/home-clips.json (the shots back to
# back in one MP4, rendered on the Mac mini via gpu2) into the home page's loops in assets/site/clips/. The shots come from
# tools/make-home-clips-shots.mjs; see its header for the whole recipe. Needs ffmpeg (libx264, libvpx-vp9), cwebp and bc.
# usage (from the repository root):
#   tools/encode-home-clips.sh <raw.mp4> <out-dir> <fps> <fade-s> <WxH> <mp4-crf> <webm-crf> name:duration [name:duration ...]
# The name:duration list must follow the shots' order in the render (START=<s> skips that much of its beginning).
# Cuts each shot out of render-film's one MP4 (the shots back to back), loops it with a cross-fade (its last
# <fade> s blended back into its start, so the loop is seamless and nothing runs backwards), and writes
# <name>.mp4 (H.264 yuv420p faststart, no audio), <name>.webm (VP9, no audio) and <name>.webp (the first frame).
set -euo pipefail
raw=$1; out=$2; fps=$3; fade=$4; size=$5; crf=$6; wcrf=$7; shift 7
mkdir -p "$out"
start=${START:-0}
for spec in "$@"; do
  name=${spec%%:*}; dur=${spec##*:}
  L=$(echo "$dur - $fade" | bc -l)          # the loop's length
  off=$(echo "$L - $fade" | bc -l)          # where the cross-fade starts in it
  W=${size%x*}; H=${size#*x}
  fc="[0:v]trim=start=$(echo "$start + $fade" | bc -l):duration=$L,setpts=PTS-STARTPTS,fps=$fps,scale=${W}:${H}:flags=lanczos,format=yuv420p[a];\
[0:v]trim=start=$start:duration=$fade,setpts=PTS-STARTPTS,fps=$fps,scale=${W}:${H}:flags=lanczos,format=yuv420p[b];\
[a][b]xfade=transition=fade:duration=$fade:offset=$off,format=yuv420p[v]"
  lp="$out/.$name.loop.mkv"
  ffmpeg -y -loglevel error -i "$raw" -filter_complex "$fc" -map '[v]' -an -c:v libx264 -qp 0 -preset ultrafast "$lp"
  ffmpeg -y -loglevel error -i "$lp" -an \
    -c:v libx264 -preset veryslow -crf "$crf" -pix_fmt yuv420p -profile:v high -tune film -g $((fps * 2)) \
    -movflags +faststart "$out/$name.mp4"
  ffmpeg -y -loglevel error -i "$lp" -an -c:v libvpx-vp9 -b:v 0 -crf "$wcrf" -row-mt 1 -deadline good -cpu-used 1 \
    -pass 1 -passlogfile "$out/.$name" -f null /dev/null
  ffmpeg -y -loglevel error -i "$lp" -an -c:v libvpx-vp9 -b:v 0 -crf "$wcrf" -row-mt 1 -deadline good -cpu-used 1 \
    -pass 2 -passlogfile "$out/.$name" "$out/$name.webm"
  ffmpeg -y -loglevel error -i "$lp" -frames:v 1 "$out/.$name.png"
  cwebp -quiet -q 80 -m 6 "$out/.$name.png" -o "$out/$name.webp"; rm -f "$out/.$name".* "$out/.$name"-0.log*
  printf '%s  mp4 %s B  webm %s B  %ss\n' "$name" "$(wc -c < "$out/$name.mp4" | tr -d " ")" "$(wc -c < "$out/$name.webm" | tr -d " ")" \
    "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/$name.mp4")"
  start=$(echo "$start + $dur" | bc -l)
done
