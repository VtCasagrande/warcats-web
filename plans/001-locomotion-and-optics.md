# 001 — Correct locomotion, camera feedback and optics

- **Status**: DONE
- **Commit**: no git repository; original alpha workspace, 2026-09-15
- **Severity**: HIGH
- **Category**: Physicality, Interruptibility, Performance, Accessibility
- **Estimated scope**: controls.ts, physics.ts, renderer.ts, models.ts and focused tests

## Problem

- `src/game/controls.ts:81`: `i.jump ||= this.keys.has('Space');` rearms a held jump each sample.
- `shared/physics.ts:57`: sprint requires only `p.stamina > 2`, while exhausted walking regenerates immediately; this oscillates gait.
- `src/game/renderer.ts:132`: distance between snapshots divided by render dt is not a stable gait speed.
- `src/game/renderer.ts:134`: `elapsed * (p.sprinting ? 14 : 10)` changes animation phase discontinuously.
- `src/game/models.ts:77`: a closed cylinder blocks the DMR optic.
- `src/game/renderer.ts:216`: visual recoil rotates the camera away from authoritative aim.

## Target

Movement: 5 m/s walking, 8.2 sprint, 2.3 crouch, 2.8 aimed; acceleration 30 m/s² grounded, deceleration 36, air control 7; normalize input. Sprint consumes 18 stamina/s, recovery 15/s after 0.6 s, locks at zero until stamina >= 25 and Shift released. Jump uses rising edge (Player.jumpHeld shared across prediction), 5.7 m/s impulse, gravity 16, cost 12; held key never repeats. p.vx/p.vz and distanceTraveled are authoritative. No movement through cover. Physical aim remains immediate.

Rendering: integrate gait phase from actual interpolated distance, one full walking cycle per 2.6 m, running cycle per 3.4 m; use exponential damping (`1-exp(-k*dt)`) for stance and gait amplitude. Camera bob <= 0.012 m walk / 0.02 m sprint; remove artificial camera recoil so reticle equals the firing ray. Gun kick can damp with k=18; ADS k=20 (~150 ms), sprint blend k=12 (~220 ms), FOV transitions k=12. Reduced motion disables bob, shake, sprint FOV and decorative menu/gun sway; preserve authoritative aiming/recoil.

Optics: use WEAPONS sight/scope/zoomAlt fields, open tube geometry, a dedicated scope overlay with accurate center and distance hashes supplied by UI. While scoped, hide view model; scoped FOV = 2*atan(tan(baseFov/2)/magnification). Shift steadies when scoped; wheel toggles zoom. Nine weapon silhouettes must differ appropriately. Client build mode uses a shared validated getBuildPlacement helper for a green/red ghost and timer.

## Repo conventions

TypeScript modules, direct Three.js, shared simulation on client/server; no React or motion dependency. UI shorthand keyboard actions stay immediate. Explicit damping is already used for ADS in renderer.

## Steps

1. Follow the root's shared fields and weapon config contracts, coordinating before modifying shared files.
2. Correct input edge handling, touch pointer ownership, ADS/zoom and build placement clicks.
3. Apply velocity/stamina/jump changes in physics and add meaningful regression tests.
4. Improve camera, locomotion, optics, weapon silhouettes, shadows and build ghost.
5. Verify compile plus jump hold, sprint exhaustion/release, repeated aim toggles, low FPS and reduced motion.

## Boundaries

Root owns simulation, world/config/types/protocol, server and session; UI executor owns UI/CSS. Only change assigned files. No installs or asset downloads without coordination. User explicitly requested implementation after the audit; execute fixes without another confirmation.

## Verification

`npm run typecheck`; focused tests. Browser held Space for 3 seconds gives one jump, holding depleted Shift does not jitter, ADS ray stays centered and opaque scope caps are absent. Build preview is visible and color reflects authoritative placement rules. Verify no model shimmer during repeated stop/start.

## Completion evidence — 2026-09-15

- `node --import tsx --test tests/movement.test.ts tests/rounds-and-weapons.test.ts`: 16 passing tests. Includes held-key jump, sprint lock/rearm, normalized movement, fine-cover collision, input routing, all nine weapon models, open optical axes, exact 12× FOV, camera/projectile ray agreement, bolt cadence and an M40 hit at 300 m with gravity compensation.
- `npm run typecheck`: passed.
- `node artifacts/final-gameplay-qa.mjs`: Chrome headless, 1440×900, 12 bots; Nordhaven, Quarry and Harbor passed at medium quality, Harbor also passed at low quality. Local gameplay only; temporary Vite server was closed after verification.
- Browser held Space produced one jump, apex 0.922 m. Held exhausted Shift did not alternate back into sprint. All four map/quality cases displayed functional 6×/12× optics and Shift steadiness.
- Browser construction checks passed: valid and invalid ghost, rotation, 200 CR debit, four-second build, completed collision cover, preview cancel and in-progress RMB cancel with full refund. The last case exposed and fixed RMB being routed to ADS during an active build.
- Browser statistics: all samples averaged 60 FPS; median frame 16.6–16.7 ms, p95 17.5–17.9 ms. Medium used 186–195 draw calls and 64,782–92,232 triangles; Harbor low used 150 calls and 45,180 triangles. These measurements describe this desktop headless run.
- Source improvements after the initial audit include smaller first-person stock/hip framing, rounded gloves and forearms, visible interior surfaces on open scope tubes, restrained weapon lighting, click-to-recapture pointer lock without firing, and albedo tints corrected for the generated terrain textures.

| Before | After | Why |
| --- | --- | --- |
| Held Space continuously rearms jump | One jump per press, shared latch verified | Stable keyboard and predicted movement |
| Sprint toggles around empty stamina | Exhaustion lock plus recovery/release | Stable gait and camera FOV |
| Snapshot-driven leg flicker and angular camera recoil | Distance-driven gait; camera follows the ballistic ray | Consistent movement and aiming |
| Large box-shaped forearms and stock | Recessed hip pose, capsules and modest bevels | Preserves the view ahead while retaining ADS |
| Colored albedo multiplied by old dark grayscale tint | Neutral albedo tint, original procedural fallback retained | Restores daylight terrain readability |

Artifacts: `artifacts/final-gameplay/results.json`, twelve map/optic screenshots, six construction screenshots, and `terrain-before.png` / `terrain-after.png`. The final terrain-only check retained 60 FPS, 195 calls and 92,232 triangles with 6×/12× optics and zero page errors.
