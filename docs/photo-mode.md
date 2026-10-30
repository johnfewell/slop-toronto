# Photo mode implementation

Development preview for `st-wt0.25`, 28 October 2026. Open `/explore.html?photo=1`
on the source server (`npm run dev`, port 5530). The normal explorer does not show
the interface without this flag. Public release remains `st-wt0.5`.

The interface provides camera framing, temporary light changes, a JPEG preview,
an editable caption/postcard border, download and a local album. Four starting
views cover the required skyline, street-level destination and viaduct categories:

| View | Camera anchor | Look target / FOV |
|---|---|---|
| Skyline from the lake | Film opener `[-2330, 8, 1030]` | `[-520, 195, 110]`, 32° |
| St. Lawrence Market | Existing validated `TELEPORT_LOCATIONS.stLawrence`, ground + 1.7 m | Market site, eye + 8 m, 54° |
| Sugar Beach | Existing scenic coordinates 43.6421, -79.3662, eye 2.6 m | CN Tower, height 120 m, 50° |
| Prince Edward Viaduct | Midpoint of the first open subway span, offset 240 m, rail + 48 m | Span midpoint, rail + 3 m, 55° |

The camera moves independently of the player's physical entity. Current interior
views keep their seat/station layers and clipping; authored exterior views use the
world layer. Closing restores the complete camera and the same ride/station owner.
Interior photographs can be saved/downloaded; recalling an old interior camera in
a different vehicle or station is refused with a message, preserving the current view.

Controls: drag to look, WASD/arrows to move, Q/E for height, Shift for faster
framing, wheel or lens slider for field of view, Space to capture, P to enter/exit,
Escape to return. Pointer/touch movement buttons are 44 px. The modal traps focus
and makes the remaining HUD inert. A standard controller uses sticks for movement
and look, triggers for height, D-pad up/down for lens, left/right for light, A for
capture/save/open, X for album/download/delete, Y for starting view/border/recall,
bumpers for views/pages and B to return. Caption text uses the native text field.

## Capture and lifetime

`js/photo-mode.js` composes the existing experience coordinator and cinema pose
function. `main.js` grants one exclusive held-frame capture lease. It skips actor
simulation, advances cloud history on independent renderer frames, waits for GPU
completion and snapshots the final canvas through native JPEG encoding. It never
passes `dt=0` through actor simulation or competes with film frame stepping.

The development policy is **256 cold samples, at most 15 seconds** through capture
encoding. This supersedes the earlier 128-sample candidate, which did not converge
for the closer portrait skyline. The three-second target remains unproven. The
fixture compares phase-matched 256/512 samples and repeats the held control;
public acceptance requires those results and the idle measurement gate.

For a large canvas, capture first encodes the WebGPU canvas, then decodes/resizes
that snapshot. Directly drawing the WebGPU presentation canvas into a 2D resize
canvas produced a black image on the Mini; a size-only check missed it. A 64×64
pixel-variation check now rejects a blank clean scene before any border/caption.
Resizing may require a second JPEG encode. Output never upscales, has a maximum
1920 px long edge and is bounded to 2 MiB. The initial quality is 0.88.

The album holds at most 60 images/64 MiB, including bounded thumbnails. Save and
oldest-item eviction commit atomically. Failed storage leaves the current image
available to download. Gallery pages decode at most eight thumbnails; leaving a
page revokes their URLs. Operation generations prevent late loads reopening a
closed view. Recall changes the camera, visual preset and cloud phase only.
The original environment returns when photo mode closes.

Composition metadata records the loaded document's build stamp, camera/space,
view key, light/cloud phase, quality/cloud tier, caption/border and encoding size.
The production builder inserts its build stamp after computing the manifest ID,
so an image cannot accidentally identify a newer deployment fetched afterward.

## Verification and release gates

Run GPU integration checks **through gpu2 on the Mini**:

```sh
GPU2_LOCK_WAIT=900 gpu2 slop-toronto-adoption-metrics -- env PHOTO_TAG=photo-validation node tools/check-photo-mode.mjs
```

Build `dist` first. The runner checks high/1600×900 and low/412×915, plus a 2200×1100
resize, and preserves JPEG downloads, screenshots, convergence receipts, lifecycle
memory snapshots and console logs. Production transcription can make these runs
contended; they establish behavior rather than performance budgets.

The 20-capture memory comparison holds the same simulation throughout. Comparing
separately resumed sessions initially flagged changing global renderer counts;
fleet creation/retirement makes those snapshots unmatched. Under a held high-tier
scene, all renderer memory fields stayed identical for 20 captures. Photo-owned
entries and known bytes returned to zero after release. Browser-managed decoder,
canvas and encoder memory remains partly unknown; this is not certification of
the whole 64 MiB temporary-memory target.

The final Mini matrix (`photo-v6`, source commit `4ffe122`, served build
`e7317b79c0d0`) passed both tiers. Its raw receipts (internal, not published here)
record the served build files and hashes; they also contain each
convergence result and all 20 memory snapshots per tier.

| Check | High | Low |
|---|---|---|
| Four views plus night skyline, 256/512 settling screen | 5/5 pass | 5/5 pass |
| Maximum whole-image mean RGB difference / p95 | 0.0704 / 0 | 0.0978 / 1 |
| Maximum same-reset control mean RGB difference | 0.0000031 | 0.0004846 |
| Renderer memory after warming each view twice, 20 captures | Identical throughout | Identical throughout |
| Tracked entries/known bytes after cleanup | 0 / 0 | 0 / 0 |
| Peak known photo CPU estimate, including large-viewport checks | 26,685,168 bytes | 26,648,045 bytes |

Both tiers passed native keyboard/pointer input (mobile touch on low), standard
gamepad polling fixtures, clean/postcard downloads, current/exterior car and
transit-seat restoration, repeated shutter/cancel, album paging/delete/late loads,
quota/disabled-storage fallbacks, controlled visibility signals and actual device
destruction. This remains functional evidence under production transcription load.
CPU tests additionally cover Escape from a focused field and in-flight resize
cancellation after a two-line UI event follow-up to the GPU build. Full suite:
209 tests, 196 pass, the same 13 historical failures by name; those failures remain
tracked by `st-6rk`.

Native file sharing is separate (`st-wt0.6`); there is no share button yet. Actual
iOS/Android devices, physical gamepad behavior, OS background policy, idle
performance and full browser-managed memory accounting remain release acceptance.
The hidden-tab fixture exercises the real handlers through a controlled visibility
signal; device-loss coverage destroys the actual WebGPU device. No public deployment
is part of this implementation task.

## Integration with multiplayer and Open Data

PR #2 incorporates development `main` at `4ead00b`. The merge retains both script
groups, the safe reload anchor and multiplayer privacy zone, place-card touch
protection and the central photo overlay gate. Multiplayer and vehicle updates run
once in the normal simulation block and stay frozen during photo framing/capture.
The capture runner accepts both navigation-timeout environment names and preserves
mobile taps alongside photo presses/downloads.

Post-merge checks: **92/92 targeted regressions pass**; the full suite has **234
tests, 221 pass and the same 13 baseline failures**. The production build passes.
A focused Mini high-tier check of build `800e7080d921` passed postcard capture with
multiplayer loaded, equal multiplayer/streetcar/subway update counts, current and
exterior streetcar-seat restoration, and photo/place-card input restoration. The
recipe is `tools/shots/photo-merge.json` with `tools/photo-fixtures.js` as the init
script; artifacts use the `photo-merge-high` prefix in the existing gpu2 output.
The optional licensed bench model was not prepared in this clean checkout and
returned 404; this check does not verify that asset's appearance.
