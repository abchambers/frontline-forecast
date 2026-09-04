# Reflectivity color table references

Real, sourced reference data for the low-end (0-20 dBZ) reflectivity color question that's come up
more than once — built 2026-09-04 specifically so this doesn't need re-investigating from scratch
next time. This file is the durable artifact; `render.ts`/`mrms-render.ts`'s `COLOR_STOPS` should
cite this file in their own comments rather than re-deriving the reasoning inline.

## Source 1: Py-ART / NWS canonical (`NWSRef` colormap)

Real, published, open-source (ARM-DOE, NOAA-affiliated). Not a screenshot sample — the actual
source-controlled RGB values, converted from 0.0-1.0 floats to 0-255 here. **Matches this app's own
COLOR_STOPS from 15 dBZ through 65 dBZ to 3 decimal places** — independent confirmation that this
app's mid-to-high range is already the real canonical standard, not something to second-guess.

| dBZ | R | G | B |
|---|---|---|---|
| 0 | 0 | 236 | 236 |
| 5 | 1 | 160 | 246 |
| 10 | 0 | 0 | 246 |
| 15 | 0 | 255 | 0 |
| 20 | 0 | 200 | 0 |
| 25 | 0 | 144 | 0 |
| 30 | 255 | 255 | 0 |
| 35 | 231 | 192 | 0 |
| 40 | 255 | 144 | 0 |
| 45 | 255 | 0 | 0 |
| 50 | 214 | 0 | 0 |
| 55 | 192 | 0 | 0 |
| 60 | 255 | 0 | 255 |
| 65 | 153 | 85 | 201 |

Source: https://github.com/ARM-DOE/cmweather (colormaps moved here from Py-ART proper), cross-checked
against https://caps.ou.edu/tsupinie/pycaps/_modules/pycaps/plot/nexrad_color_tables.html

**Low end is bright and saturated** — cyan at 0 dBZ, straight into a fully-saturated pure blue by 10
dBZ. This is "the" textbook NWS scale, but real users (including Andrew, live, more than once) have
found this specific bright treatment reads as harsh against a dark basemap.

## Source 2: GRLevel3 / GR2Analyst (`default_BR_full.pal`)

Real, published `.pal` file from a separate, independently-popular professional radar tool (widely
used in the storm-chasing/met community). Raw file, not a screenshot:

| dBZ | RGB (color at this point) |
|---|---|
| -10 | (64, 64, 64) — muted dark gray |
| 10 | (164, 164, 255) — light blue/lavender |
| 20 | (64, 128, 255) — medium blue |
| 30 | (0, 255, 0) — green begins |
| 40 | (255, 255, 0) |
| 50 | (255, 0, 0) |
| 60 | (255, 0, 255) |
| 70 | (255, 255, 255) |
| 80 | (128, 128, 128) |

Source: https://qsl.net/k/kc9njw/GRLevelX/GRLevel3_2/ColorTables/default_BR_full.pal

**Low end is muted and pastel** — dark gray below 0 dBZ, a soft lavender-blue by 10 dBZ, not
reaching a fully saturated blue until 20+ dBZ. Uses 10 dBZ steps, not this app's 5 dBZ steps.

## Source 3: RadarScope (visual estimate only — real limitation, not a precise sample)

Andrew sent a real screenshot of RadarScope's own legend bar (2026-09-04), but it wasn't accessible
as a local file this session, so this is a **visual read, not a pixel-sampled value** — treat this
row as lower-confidence than the two above until someone can save the actual image file and re-run
a real `getImageData`-based sample (same method already proven on the live NWS radar.weather.gov
legend earlier the same night).

Visual read: the low end progresses near-black -> dark navy/indigo -> blue -> cyan, arriving at
green. Real blue is clearly present (not muted to gray/tan), qualitatively closer to source 2's
"muted but present" character than source 1's fully-saturated bright cyan.

## Source 4: Live NWS radar.weather.gov legend (real pixel sample, but see the caveat below)

Pixel-sampled directly via canvas `getImageData` against the live public page, same night. Real,
precise numbers, but this specific sample is now suspect: it showed a muted GRAY-TAN at the very
low end with much less blue character than sources 1, 2, and 3 all agree on. Possible explanations,
not yet resolved: a genuine miscalibration in the px-to-dBZ mapping used at sample time (tick
positions were estimated, not measured precisely), or radar.weather.gov's own renderer genuinely
using a non-canonical low end. Given 3 of 4 sources agree real blue belongs in this range, this
sample's specific RGB values should NOT be trusted as the deciding reference going forward.

## Working conclusion, 2026-09-04

Real blue belongs in the 0-20 dBZ range — 3 of 4 sources agree, and the 4th (radar.weather.gov) is
now suspect. The right calibration question isn't "gray or blue" (blue wins), it's "how saturated" —
Py-ART's fully-saturated bright cyan/blue vs. GRLevel3's muted pastel version. Given Andrew's
original, real complaint was specifically about the ORIGINAL bright, fully-saturated version
reading as harsh, GRLevel3's muted-but-real-blue treatment is the better-evidenced target: present,
recognizably blue, not gray, but not screaming either.
