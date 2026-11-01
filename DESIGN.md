---
name: Slop Toronto
description: Downtown Toronto and the waterfront in 3D, set as this week's free city paper.
colors:
  newsprint: "#e9e6dc"
  black-ink: "#151412"
  grey-ink: "#3d3a34"
  spot-red: "#d8261c"
  deep-spot-red: "#b3170f"
  process-yellow: "#ffd23f"
typography:
  masthead:
    fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(64px, 8.2vw, 118px)"
    fontWeight: 900
    lineHeight: 0.8
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 62"
  display:
    fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(68px, min(10vw, 17svh), 144px)"
    fontWeight: 900
    lineHeight: 0.86
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 62"
  figure:
    fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(52px, 6.4vw, 96px)"
    fontWeight: 900
    lineHeight: 0.9
    fontFeature: "'tnum' 1, 'lnum' 1"
    fontVariation: "'wdth' 62"
  headline:
    fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(28px, 3.2vw, 46px)"
    fontWeight: 900
    lineHeight: 1.05
    fontVariation: "'wdth' 70"
  title:
    fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(30px, 2.7vw, 42px)"
    fontWeight: 900
    lineHeight: 0.95
    fontVariation: "'wdth' 70"
  listing:
    fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "21px"
    fontWeight: 900
    lineHeight: 1
    fontVariation: "'wdth' 75"
  dek:
    fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(19px, 1.6vw, 23px)"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 450
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 750
    lineHeight: 1.35
    letterSpacing: "0.04em"
rounded:
  none: "0px"
spacing:
  gutter: "clamp(16px, 2.2vw, 32px)"
  column: "28px"
  column-wide: "40px"
  section: "64px"
  section-phone: "48px"
  backpage: "72px"
components:
  search-label:
    backgroundColor: "{colors.spot-red}"
    textColor: "{colors.newsprint}"
    rounded: "{rounded.none}"
    padding: "8px 16px 6px"
  search-field:
    backgroundColor: "{colors.newsprint}"
    textColor: "{colors.black-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 16px"
  search-submit:
    backgroundColor: "{colors.black-ink}"
    textColor: "{colors.newsprint}"
    rounded: "{rounded.none}"
    padding: "0 22px"
  search-submit-hover:
    backgroundColor: "{colors.spot-red}"
  section-bar:
    backgroundColor: "{colors.black-ink}"
    textColor: "{colors.newsprint}"
    typography: "{typography.headline}"
    rounded: "{rounded.none}"
    padding: "7px 12px 5px"
  button-more:
    backgroundColor: "{colors.black-ink}"
    textColor: "{colors.newsprint}"
    rounded: "{rounded.none}"
    padding: "10px 14px 9px"
  button-more-hover:
    backgroundColor: "{colors.deep-spot-red}"
  button-go-big:
    backgroundColor: "{colors.black-ink}"
    textColor: "{colors.newsprint}"
    rounded: "{rounded.none}"
    padding: "16px 24px 14px"
  button-go-big-hover:
    backgroundColor: "{colors.spot-red}"
  listing-row:
    textColor: "{colors.black-ink}"
    typography: "{typography.listing}"
    padding: "5px 6px"
  listing-row-active:
    backgroundColor: "{colors.black-ink}"
    textColor: "{colors.newsprint}"
  sticker:
    backgroundColor: "{colors.process-yellow}"
    textColor: "{colors.black-ink}"
    rounded: "{rounded.none}"
    padding: "6px 10px 5px"
  red-box:
    backgroundColor: "{colors.spot-red}"
    textColor: "{colors.newsprint}"
    rounded: "{rounded.none}"
---

# Design System: Slop Toronto

> **Scope:** this system covers the landing page only (`index.html`, `css/landing.css`, `js/landing.js`). It does not describe the 3D explorer's interface (`explore.html`), which has its own visual language.

## Overview

**Creative North Star: "The City Weekly"**

The home page is this week's free Toronto alt-weekly. It is printed, not rendered: one sheet of warm newsprint, black ink, one spot red for the boxes, and one process-yellow sticker slapped on the cover. Everything that would make it a tech launch page is refused: no dark video hero with a centred headline, no grid of feature cards, no glass, no glow. The 3D city appears the way a paper shows a photo: as the cover picture and as listing thumbnails, framed by heavy rules and captioned.

The density is a paper's. The first viewport is a front page: a masthead with a live issue line (ISO week, date, Toronto time and the light outside) and a weather ear, a section strip, then a cover story beside a listings rail that ends on a Corrections box. Below the fold come sections behind reverse-type bars, two-to-four newspaper columns with run-in heads, a table of readings with sources, and a back page in a red box. Type does the structure; rules do the dividing; the footage does the persuading.

Time is part of the state. The cover's resting clip follows Toronto's light (golden hour, midday, sunset, night), the sticker says "Screenshot" or "Footage" depending on what is showing, and hovering or tapping a listing swaps the cover to that place.

**Key Characteristics:**
- Newsprint ground, black ink, one spot red, one yellow sticker per view.
- Archivo across its width axis: extra-condensed 900 caps for heads, normal width for copy.
- Thick black rules (2px and 6px) instead of cards, borders-with-radius or shadows.
- Reverse-type section bars and red boxes as the only "containers".
- Every picture and clip is the app itself, captioned like a news photo.
- Square everything; flat everything.

## Colors

A two-ink newspaper palette: black on warm newsprint, with a spot red and a single yellow sticker as the only colour that is not the city's own footage.

### Primary
- **Spot Red** (`spot-red`): the boxes. The "Slop" box in the masthead and colophon, the red "Where to?" label on the search, the 504 type block, the back page's headline slab, the distance numerals in the listings, link underlines on hover and the text caret. Large type and solid boxes only.
- **Deep Spot Red** (`deep-spot-red`): the same red deepened for small type and small controls. The "Ride" in the section strip, the distance key in the rail, and the hover fill of the small ink buttons ("Open the city", "Ride the 504"). Added by the builder for contrast.

### Secondary
- **Process Yellow** (`process-yellow`): the cover sticker that says the picture is from the app ("Screenshot from the app" / "Footage from the app"), rotated -3deg. It also serves as the focus ring on the ride clips' preview control, where ink and paper rings would vanish over footage.

### Neutral
- **Newsprint** (`newsprint`): the page itself, the search field, text reversed out of ink and red, the theme colour.
- **Black Ink** (`black-ink`): all body text, every rule, the section bars, the ink buttons, the active listing row, the cover's backing and its scrim (as translucent ink, from 0.9 at the foot to 0 at 84% up).
- **Grey Ink** (`grey-ink`): secondary small print only, such as ride captions and the colophon's fine print.

### Named Rules
**The Two-Ink Rule.** The page is printed in two inks on newsprint: black and spot red (with its deepened cut for small type). The yellow sticker is pasted on, not printed. No further hues, no decorative tints; the only gradients and transparencies are ink and newsprint over footage, for legibility.

**The Deepened Red Rule.** Spot Red against Newsprint is 4.0:1, so it is allowed only for large type (bold 18.66px and up, which is why the shortest-window distance numerals stop at 18.7px) and for solid boxes carrying large reversed type. Any smaller red text, or a hover fill behind small type, uses Deep Spot Red.

**The One Sticker Rule.** Process Yellow appears once per view, as the sticker. It is never a fill, a highlight or a button colour; its only other use is a focus ring over footage.

## Typography

**Display Font:** Archivo, self-hosted variable (width 62-125%, weight 400-900), with Helvetica Neue and Arial as fallbacks
**Body Font:** Archivo at normal width
**Label Font:** Archivo at normal width, uppercase, tracked

**Character:** one grotesque family stretched across its width axis, the way a paper sets its heads in a condensed cut of its text face. Width is the hierarchy: 62% for the loudest heads, 70% for bars and story heads, 75% for listings, 100% for anything read as a sentence.

### Hierarchy
- **Masthead** (900, 62% width, clamp 64-118px, line-height 0.8, uppercase): the name, with "Slop" reversed out of a red box. Phones: clamp 48-96px.
- **Display** (900, 62% width, clamp 68-144px capped by 17svh, line-height 0.86, uppercase, balanced): the coverline only. Phones: clamp 60-120px. The back page headline uses the same voice at clamp 64-156px inside a red slab.
- **Figure** (900, 62% width, clamp 52-96px, tabular lining numerals): the readings in By the numbers and the live outside temperature (clamp 44-68px).
- **Headline** (900, 70% width, clamp 28-46px, line-height 1.05, uppercase): section bars. The rail's bar is clamp 25-32px.
- **Title** (900, 70% width, clamp 30-42px, line-height 0.95, uppercase): story heads and sight names (30px; the lead sight clamp 34-50px).
- **Listing** (900, 75% width, 21px, line-height 1, uppercase): place names in the rail.
- **Dek** (600, clamp 19-23px, line-height 1.3, max 44ch): the cover's one line of copy; section deks are 19px/550 at max 62ch.
- **Body** (450, 17px, line-height 1.5): copy, set in 52-62ch measures or in newspaper columns.
- **Label** (750, 14px, uppercase, +0.04em): the masthead's issue line and weather ear; the strip uses 800 at +0.02em; table heads and source credits 13px at +0.05-0.06em.

### Named Rules
**The Width-Axis Rule.** Hierarchy comes from width and size, never from a second family. Heads are condensed 900 caps; anything meant to be read as a sentence is normal width and sentence case.

**The Run-In Rule.** Column paragraphs open with a bold uppercase run-in head (900, +0.01em) inside the paragraph, as a paper does. No separate small-caps labels above headings.

Accepted exception: the masthead and the coverline (and the back page headline) exceed 96px by design. They are the paper's nameplate and its splash; nothing else on the page goes above 96px.

## Layout

A broadsheet front page, then a single column of sections at a maximum of 1600px with fluid gutters (clamp 16-32px).

- **Masthead:** a three-column grid (issue line, name, weather ear) on a 6px rule; the weather ear mirrors the issue line in two lines and keeps its space when the reading fails, so the name stays centred. Phones: the name takes the full width, the issue line and weather ear sit side by side below it.
- **Section strip:** a single horizontally scrolling row of uppercase links over a 2px rule, with the black "Open the city" cell flush right (hidden on phones).
- **Front page:** cover and rail side by side (rail clamp 340-410px), together filling the rest of the first viewport (at least 560px) and ending on a 6px rule. The coverline block sits bottom-left on the cover; the listings share out the rail's spare height so the Corrections box lands at the foot. Short desktop windows (861px+ wide, 860px tall or less) tighten the rows so Corrections still lands in the first screen.
- **Phones (860px and narrower):** masthead, then the cover with the search, then the listings. The cover is tall enough (up to 692px) for the CN Tower's pod to stand clear above the coverline, and its crop follows the tower via a computed object-position.
- **Accepted exception:** on phones shorter than 840px the cover falls back to a shorter height (up to 640px) so the search stays in the first screen; the pod may sit behind the coverline there. The search wins.
- **Sections:** 64px apart (48px on phones), each opening on a section bar. Ride the TTC is a 1fr 1fr 0.72fr grid split by 2px vertical rules (two columns under 1180px, one on phones); Off the lake is 1.6fr 1fr 1fr; How it works and What's real use CSS columns (3 at 260px, 4 at 220px) with 40px gaps and a 1px ink column rule.
- **Back page and colophon:** the back page sits 72px down; the colophon opens on a 6px rule in two columns.

## Elevation & Depth

None. The page is flat paper: no box-shadows, no blur, no stacked surfaces. Depth is carried by ink weight (a reversed bar or active row reads as "on top") and by the footage itself. The only layering is the cover: footage, then a translucent ink scrim, then type; controls over footage sit on translucent ink plates (0.72-0.78) with a 2px paper border.

### Named Rules
**The Flat Sheet Rule.** Nothing casts a shadow and nothing floats. Hierarchy is ink, rule weight and type size. Translucent ink over footage is allowed for legibility; frosted or blurred glass is not.

## Shapes

Square. Every corner is 0px, including the search field and buttons (native radius is reset). Lines are the shape language, in a fixed scale: 1px column rules, 2px rules between rows and columns, 3px borders on boxed notices (Corrections, the outside reading), a 4px paper frame around the search, and 6px heavy rules closing the masthead, the front page and opening the colophon. Icons are three inline SVG strokes (arrow, play, pause) at stroke 2.6 with square caps and mitred joins. The only off-axis shape is the sticker's -3deg tilt.

### Named Rules
**The Rule-Weight Rule.** Use the line scale (1, 2, 3, 4, 6px, all Black Ink, or Newsprint over footage) to separate and box. Never a tinted border, never a radius.

## Components

Printed, blunt and confident: ink blocks with reversed caps, and a hover that inks the block red.

### Buttons
- **Shape:** square (0px).
- **Primary (ink block):** Black Ink fill, Newsprint 900 uppercase text with a trailing arrow. Small sizes ("Ride the 504", 15px, padding 10px 14px 9px; "Open the city", 14px) hover to Deep Spot Red; large sizes ("Explore Toronto", 70% width 30px, padding 16px 24px 14px; the search's "Go", 22px) hover to Spot Red. The arrow nudges 3-4px right on hover. Transitions 0.2s on the house ease.
- **Over-footage control (pause, preview):** 36-44px tall, a 2px paper border on a translucent ink plate; hover reverses to Newsprint with ink text. On phones the pause button is icon-only but keeps its accessible name. Pressed state swaps the icon.
- **Focus:** a 3px Black Ink outline at 3px offset; Newsprint inside the cover; Spot Red on the search button (inset) and on a focused listing row; Process Yellow on the ride preview control.

### Inputs / Fields
- **The "Where to?" search (signature):** one strip inside a 4px Newsprint frame: a Spot Red label in 70% width 900 caps (30px), a Newsprint field at 21px/550 with a muted ink placeholder (#5a564d) and a red caret, and the ink "Go" block. Focus puts a 3px Newsprint outline around the whole strip. Phones: the label takes its own row at 26px, the field is 54px tall at 16px.

### Navigation
- **Section strip:** uppercase 14px/800 links with 16-28px gaps; hover adds a 3px Spot Red underline. One word may be picked out in Deep Spot Red. Horizontal scroll without a visible scrollbar on narrow screens.

### Section Bar
- A reversed Black Ink slab with Newsprint headline caps, sitting at the head of every section and the rail. It is the page's only section heading style.

### Listing Row
- A three-column row (76px 16:9 thumbnail, name and detail, preview control on touch) between 2px rules. The name is the Listing style; the detail leads with a Spot Red distance numeral. Hover, focus or the active place reverses the row to ink (0.18s) and swaps the cover to that place's clip; the whole row is the link. On touch devices a 44px preview button plays the clip inline above the row.

### Boxed Notices
- **Corrections:** a 3px ink box at the foot of the rail, with an uppercase bold run-in ("Corrections:") stating what is art and that WebGPU is needed.
- **Outside right now:** a 3px ink box with the live Pearson temperature in the Figure style, its condition, and the source credited. It and the masthead weather ear come from Environment and Climate Change Canada; if the reading fails or is older than three hours, both stay hidden (the ear keeps its line height so the masthead does not jump).

### Sticker
- Process Yellow, 15px/900 uppercase ink text, rotated -3deg, top-left of the cover. It states provenance ("Screenshot from the app" / "Footage from the app") and is the page's single yellow.

### Logo
- John's brand logo (`assets/brand/`, made by him with Google Gemini, the one picture on the page that is not the app) comes in two drawings, both flat colour with clean black outlines: the tall logo (a tipped yellow can marked ST pours green slime over the CN Tower, master `slop-toronto-logo.png`) and the square mark (the can and a short pour only, master `slop-toronto-mark.png`). Both masters are transparent and never ship; only their web sizes do.
- The tall logo's tower shaft is cut flat at the bottom, so it never floats: it always stands on a heavy rule. As the masthead crest (1024px and wider) its cut end sits exactly on the masthead's bottom rule, the tower rising out of it, a little taller than the name with an empty box of the same width balancing it on the right so the name stays centred. Below 1024px it is dropped (it would push "Outside, at Pearson" onto a second line, and on phones the name already fills the width). On the back page it stands at the right of the slab, reaching down so its cut end lands exactly on the colophon's heavy top rule; on phones it stands centred under the button on that same rule.
- The square mark is the site icon: favicons (32/16, transparent), the apple-touch and web app icons (180/192/512 on newsprint, the 512 maskable-safe) and the 36px brand button and map logo in the app.
- Neither drawing is ever recoloured, redrawn or cropped, and their green stays inside the logo.

### Motion
- One authored moment on load, behind `prefers-reduced-motion: no-preference`: the red masthead box inks in from the left (0.7s), the coverline presses up into view (0.9s), the sticker slaps on (0.5s, from -9deg and 1.25x). Otherwise motion is state only: 0.2s colour changes, a 0.6s fade from poster to footage, a 0.45s cross-fade when a listing takes over the cover. All on `cubic-bezier(0.16, 1, 0.3, 1)`. Clips are muted loops and never autoplay under reduced motion or Save-Data.

## Do's and Don'ts

### Do:
- **Do** use only pictures and clips captured from the app itself: in-app screenshots and muted in-app loops, captioned "in the app". Never outside renders, stock photography or generated imagery. The one exception is the logo (see Logo), which is a brand mark, not a picture of the city.
- **Do** set heads in Archivo 900 caps at 62-75% width and copy at normal width; get hierarchy from width and size.
- **Do** divide with Black Ink rules on the 1/2/3/4/6px scale and contain with reversed ink bars or red boxes.
- **Do** keep Spot Red to boxes and large type; switch to Deep Spot Red for anything smaller than bold 18.66px.
- **Do** use Process Yellow once per view, as the provenance sticker.
- **Do** set figures in tabular lining numerals and credit their source beside them; every figure comes from the city data.
- **Do** keep footage legible with the translucent ink scrim under type, not by dimming the whole frame.
- **Do** guard the load animation and all autoplaying clips behind reduced-motion and Save-Data checks.

### Don't:
- **Don't** use rounded corners anywhere (0px, including inputs and buttons).
- **Don't** use box-shadows, drop shadows or glows; the page is a flat sheet.
- **Don't** use frosted or blurred glass panels (backdrop-filter); translucent ink plates over footage are the only see-through surface.
- **Don't** build a dark video hero with a centred headline and a grid of feature cards.
- **Don't** add a second typeface or a system display face; Archivo's width axis is the whole range.
- **Don't** add small uppercase labels above headings; the paper uses section bars and run-in heads.
- **Don't** add new inks, tints or decorative gradients beyond newsprint, the two inks, spot red and its deepened red, and process yellow.
- **Don't** imitate any real paper's masthead or name; the genre is the alt-weekly, not a specific title.
