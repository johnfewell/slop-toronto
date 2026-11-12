# Central waterfront refinement

This pass replaces generic mapped building treatments at Queens Quay Terminal, the Power Plant, Harbourfront Centre's Main Building and the Concert Stage. Source photos were inspected by eye and the work was integrated and tested before acceptance.

## Source and interpretation

- Terminal: [Toronto Society of Architects / Zeidler photographs](https://torontosocietyofarchitects.ca/buildings/queen-quay-terminal/) support cream warehouse piers, green window framing, residential balconies and the north clock shaft. Eleven mapped parts remain. Eight warehouse levels fit the mapped height; bay proportions, clock size and material colours are photo-informed estimates. Historical parking is not reproduced.
- Power Plant: [official Harbourfront photograph](https://harbourfrontcentre.com/wp-content/uploads/2021/10/TPP-Buidling-1024x768.jpg) supports muted brick, industrial multipane windows, glazed entry, pyramidal entry roof and red signs. Eight mapped parts remain. A small hip-roof shaft seen near the chimney is omitted because its vertical placement among overlapping massing remains unresolved; it is not relocated for visibility.
- Main Building: [2025 accessibility guide](https://harbourfrontcentre.com/wp-content/uploads/2025/04/04142025_hc_accessibility_guide_2025-compressed.pdf), pp.4/10, supports the charcoal three-storey east face, silver window frames, white lettering and open northeast entrance canopy. The exact unnamed canopy strip is a photo/map inference; other unnamed rows remain. The source entrance steps/ramp are not surveyed; the approach remains simplified ground.
- Concert Stage: [structural designer Blackwell](https://blackwell.ca/portfolio/project/harbourfront-centre-stage), [Cast Connex](https://www.castconnex.com/projects/harbourfront-centre-stage), and the guide p.23 support an open membrane canopy, masts/cables, fixed seating and raised deck. The procedural roof, representative mast count, seating layout and 0.3m platform are estimates, not engineering drawings. The rear ramp has exact rendered movement footing and a grade near 1:17.

## Integration

Replacement predicates match stable mapped identities, activate only after their builders succeed, and clear on a different/unresolved geodata object. Native building collision remains; the entrance canopy has thin post and overhead proxies rather than a solid walkway blocker. The stage has exact deck/ramp sampling through the existing ground resolver and a height-bounded roof camera proxy. Both new culling roots load before generic buildings.

## Visual evidence

Captures reside under `$GPU2_REVIEW_DIR/slop-toronto-waterfront-bia/`.

| Subject | Before | After |
|---|---|---|
| Terminal | `wave8-central-before-terminal-clock.png` | `wave8-central-final-terminal-clock.png` |
| Power Plant | `wave8-central-before-powerplant-street.png` | `wave8-powerplant-corrected-powerplant-street.png` |
| Campus | `wave8-central-before-harbourfront-campus.png` | `wave8-central-final-harbourfront-campus.png` |
| Stage | `wave8-campus-before2-stage-waterfront.png` | `wave8-central-final-stage-waterfront.png` |
| Main east facade | campus before above; original close view was obstructed | `wave8-central-final-main-east.png` (clearer camera, not a matched comparison) |

The ten-view desktop acceptance includes an 81-sample controller walk from the ramp bottom onto the stage deck, checking exact ground heights and absence of horizontal blockers. Phone uses 412×915 at DPR 2.625 and low quality. Captures establish functional/visual behaviour, not frame-rate budgets on the shared GPU host.

## Limits

This is a substantial procedural identity pass, not photorealism. Roof plans, precise cladding relief, the stage's engineered space-frame and seating dimensions, entrance terrain, and several adjacent unnamed structures remain simplified. Generic campus planting and some roof shadow artifacts remain visible. Source photographs are review references only and are not shipped as textures.

## Verification record

Focused checks: Terminal 30/30; Main Building 16/16; Power Plant 18/18; Concert Stage plus movement 24/24. The real-runtime test now includes the two new builders and passes both detail and eglinton frames. The first broad run found two nonfinite Power Plant clerestory transforms; an omitted depth estimate was corrected and both real-runtime frames passed afterward. Final `npm test`: 1,179 tests, 1,176 passed, zero failed, three skipped (111 seconds). Log: `$WATERFRONT_RESEARCH/wave8-central-final-full-tests.log`. `git diff --check` passed. Final corrected build: `ccb085b4dbd7`.

Desktop ten-view capture `wave8-central-final` and phone ten-view capture `wave8-central-phone-final` completed exit 0. The corrected Power Plant materialized rooftop box is covered separately by `wave8-powerplant-corrected` and `wave8-powerplant-phone-corrected` (street/aerial). Runtime live-vehicle requests return the known 404 on the isolated static capture server. No frame-rate acceptance is inferred.
