# 002 — Complete operation lifecycle and make interaction states visible

- **Status**: IN PROGRESS
- **Commit**: no git repository; original alpha workspace, 2026-09-15
- **Severity**: HIGH
- **Category**: Purpose, Interruptibility, Cohesion, Accessibility
- **Estimated scope**: src/ui/ui.ts, src/ui/map.ts, src/style.css, new UI helpers

## Problem

`src/ui/ui.ts` exposes a deploy button and round result, but no preparation countdown, persistent account, actual shop purchase feedback, construction ghost confirmation or optical scope overlay. `src/style.css` uses tiny labels and unicode substitutes for functional icons. These gaps hide the relationship between operator action, cash and game state.

## Target

Preserve the existing WAR CATS military lobby while showing a full round state: warmup -> active -> results -> intermission -> next map. Use real `state.phase`, `phaseEndsAt`, map name and a preparation countdown. Guest local play remains available; signed-in accounts expose wallet, stats and logout. Real shop shows price/affordability and explicit buy/equip actions. In-play purchases occur at base or during preparation/death, with server feedback.

Use a coherent SVG icon set with viewBox, consistent stroke width 1.6, aria-hidden decorative glyphs and accessible button labels. No arbitrary unicode glyphs for weapons, settings, health, aim or actions. SVG sniper scope uses center crosshair, calibrated relative hashes, black peripheral mask, zoom and steady-state labels.

Motion tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. Press feedback `scale(.97)` over 120 ms; pointer-triggered occasional modals opacity/scale(.98) 200 ms, toast opacity 160 ms. Keyboard map/score/menu immediate. Progress via transform scaleX with linear interpolation, never artificial progress. Reduced motion drops scale and positional shifts while preserving opacity/status feedback. HUD utility labels >= 9px desktop where practical; body text >=12px. Protect mobile touch zones.

## Repo conventions

UI class callbacks drive main/session, settings localStorage. Shared Match/Player/config supply every live value. Root owns shared types and backend. Menu PT-BR terminology already established.

## Steps

1. Build icon helpers and use them consistently in menu/HUD; keep logo identity.
2. Add account modal, stateful errors/loading, wallet and shop, connecting root-provided APIs and callbacks.
3. Render match lifecycle/countdown/result/intermission, map info, zone/hot zone earnings and actual time at objective.
4. Show placement instructions, build completion/cancel state and scope controls.
5. Increase legibility, preserve responsive layouts and align markup/contracts with root.

## Boundaries

Modify only src/ui and src/style.css. No server/main/shared edits, no deployment. User already requests all fixes. Avoid disabling gameplay behind menus: inform that online continues. Never fake balances, purchases, timers or accounts.

## Verification

Typecheck after shared contracts land. Browser: account register/login/logout, errors, shop affordability, buy in permitted states, warmup/round result/next map, scope overlay, construction hints, 390px and desktop layouts. No animation delays for keyboard actions. Keep Before/After/Why evidence in final report.
