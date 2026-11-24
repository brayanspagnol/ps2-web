# God of War: characters partly hidden by see-through textures (2026-11-05)

Branch `gow-alpha-fail` of the Play! fork (worktree `.claude/worktrees/gowtex/play`, from web-perf f35c5ea5).
Test build: `public/emu-gowz2`. Not published, not merged.

## Report
Testers on Windows (AMD and Nvidia), God of War USA, Hydra fight on the ship: enemies and Kratos "partly vanish
because of the texture". No screenshot, not reproduced on the reported scene or GPUs.

## Cause
Nearly all God of War geometry is drawn with `TEST` ATE=1, ATST=GEQUAL, AREF=0x60, AFAIL=3 (RGB_ONLY), depth
writes on. On the GS, a fragment that fails that test still writes color but not depth or alpha. Without framebuffer
fetch (WebGL never has it) the shader had nothing to do for that case (see the TODO in `GenerateAlphaTestSection`,
in upstream since 2d2a3682), so every fragment wrote depth. The see-through part of a texture therefore hid whatever
the game drew behind it afterwards, with the background showing instead.

Not GPU-specific and not a regression of a web-perf commit: it reproduces on Intel, on the default ANGLE backend.

## Fix
`FlushVertexBuffer`: when depth writes are on and the fail mode is RGB_ONLY or FB_ONLY, draw twice: passing fragments
with all writes, then failing fragments (inverted test) without depth, and without alpha for RGB_ONLY. The GS orders
per primitive; in one batch the failing fragments now come after all passing ones (same trade-off GSdx makes).
Two draws for all geometry halve the frame rate (gow-fight 2x: 17 -> 8.3 frames/s), so `CanFailAlphaTest` skips the
second pass when the palette minimum alpha and the vertex alpha prove no fragment can fail.
The alpha test now decides what writes depth, so the float to integer conversions got a small bias: a value of
exactly n/255 must not truncate to n-1 (GLSL does not promise n/255.0*255.0 >= n; one ulp low does truncate).

## Evidence
Deterministic frames: a debug build pauses the VM itself at vblank N (`hash=N&vu1thread=0&nolimit=1`), so pictures
of the same emulated moment can be compared pixel by pixel (two runs of one build: no pixel differs by more than 2/255).
- gow-fight 2x vblank 900: the frayed part of Kratos's skirt shows the deck through it before the fix, the leg and
  cloth layers behind it after. The same holes are in emu-green0 (before 75a0d770), emu-greenpub and the live build.
- gow-fight vblank 300: 2.1% of pixels change: grate openings, chain and rope edges.
- GTA play.zip vblank 300: trees lose the sky-colored chunks cut out of them (independent confirmation of the cause).
  FFX mtvu-ffx: no pixel differs by more than 2/255.

## Ruled out as the cause
- Dropped draws, `Feedback loop formed between Framebuffer and active Texture`: real (GL error 0x502), also on the
  default backend, and the code that causes them is not specific to a publish (only PSMCT16 self-texturing goes through
  a copy). Two states, both PSMCT32 buffer 0 sampling itself: sprites with alpha masked, and triangles whose blend keeps
  Cd. A debug build that samples a copy instead changed no pixel by more than 2/255 at gow-fight vblanks 300 and 900,
  so they look invisible here. UVs were not logged and combat frames were not compared this way. Not fixed.
- Alpha truncation on other GPUs: forcing every conversion one unit low only changes pixels by small amounts
  (1.8% of pixels by more than 2/255, none by more than 23/255). Before this fix nothing was discarded in this state.
- 75a0d770, 63277571 and 8ee6bab3: the holes are in builds older than 75a0d770 and in code from upstream.
  EE hashes match, and the holes appear without any timing dependence.
- Bright red blobs in fights: they fly to Kratos and sit on him on hits, which fits the game's red orbs, and the fix
  leaves them alone. No hardware reference was compared.

## Checks
Hash gate on emu-gowz2: car 55dab76e, play 1f851c1c, gow-fight 77f177fc, gow-intro b2119704, mtvu-ffx 5927b89c,
car and play with vu1thread=1 match too. Speed gow-fight 2x, vblanks 100-1300: naive two passes 8.3 frames/s, final
20.6, emu-combo1 16.4, 18.0, 17.5 (one final run, other work on the machine, so read it as "no visible cost").

## Unverified
- The Hydra scene, and the report itself: the testers have not confirmed this is what they saw.
- AMD, Nvidia and D3D11: nothing in the fix is backend specific, but it has only run on Intel.
- No PS2 or PCSX2 reference. Grate openings on the deck now show boards below instead of black, and GTA foliage
  edges got a thin blue-green fringe. Both follow from the GS rules as I read them, but check them against a reference.
- AFAIL ZB_ONLY still discards depth too (GoW does not use it in these frames).
