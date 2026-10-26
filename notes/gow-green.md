# God of War: green stripes (2026-10-26)

Branch `gow-green` of the Play! fork (worktree `play-green/`, from web-perf 63c749a2), commit 75a0d770.
Test builds: `public/emu-green0` (web-perf as is), `public/emu-green1` (fix). Not published, not merged.

## Symptom
Thin vertical green lines over the whole picture, one every 8 GS pixels (every 20 output pixels at 2x).
Reproduced on gow-fight.zip at 2x and 3x. Not reproduced at 1x: neither with `res=1` from boot nor
after switching 2x -> 1x or 1x -> 2x mid-run (stripes follow the factor in use, 1x stays clean).
gow-intro.zip has no shuffle there and shows no stripes at any factor. So the report's "1x" does not match
what the emulator does; the bug shows above 1x (the site default is 2x).

## Cause
God of War builds its shadow mask in the green channel of the PSMCT32 frame buffer and moves it with
PSMCT16 channel-shuffle draws: sprites 8 pixels wide, frame and texture on the same memory (fbAlias,
commit 63277571). For PSMCT16 -> PSMCT16 copies, `DoRenderPassWithCopies` moved the *geometry* half a
GS pixel (projection -0.5..W-0.5) so GL would sample like the GS (pixel corner, not center).
At 1x that is fine. At a factor s, half a GS pixel is s/2 scaled pixels: each sprite covers scaled
columns [s*x0 + s/2, s*x1 + s/2), so its first scaled column (and row) is never drawn. The shuffle
leaves the stale green mask there: one green line per 8 pixel sprite.

## Fix
The half texel goes into the texture matrix instead (column 2, multiplied by q, so it is right for STQ
as well as UV), and the geometry stays put. Coverage is exact at every factor; at 1x the same texels are
sampled as before (same math: attribute at x+0.5 minus 0.5 texel == attribute at x). Generic GS code, no
per-game check.

## Checks
Screenshots: `node shot.mjs` (scratchpad `green/`): own tab, bench.html with `res=N&hash=N`, waits N
vblanks after the state load, pauses the VM and saves the last GS frame. Frames are not taken at an exact
vblank (pause from CDP), so before/after pairs can be a frame or two apart.
- Stripe metric (`stripes.py`: per-column green excess spikes): gow-fight 2x 128 spike columns -> 0,
  3x 128 -> 0, 1x 0 -> 0. gow-intro 0 -> 0.
- GTA play/car and FFX mtvu-ffx at 1x and 2x: same picture before/after (car 2x pixel-identical; other
  differences are the frame timing). A debug build showed FFX never takes the PSMCT16-copy path.
- Hash gate (default res, `hash=300&vu1thread=0&nolimit=1`) with the fix: car 55dab76e, play 1f851c1c,
  gow-fight 77f177fc, gow-intro b2119704. mtvu-ffx gives 5927b89c most of the time but is flaky on
  both builds (web-perf build too: 1ff83c4c once in 3 runs; fix build 3 different values in 6 runs).
  It diverges at vblank ~280 in EE RAM only; FFX does one 32x32 PSMCT32 GS -> EE readback at address 0
  there. Pre-existing, unrelated (the changed code does not run in FFX).
