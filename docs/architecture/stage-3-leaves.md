# Stage 3: config comments and the first leaf modules (plan, 2026-11-24)

Status: **done** - 3a v1.237.6-pilot, 3b v1.237.7-pilot, 3c v1.237.8-pilot. After stage 2 (all classes as modules), same branch (`modular-pilot`), **no change in
behaviour**. Steps 2 and 3 of the module plan's order.

## 3a. Config comments (no behaviour change at all)

`bot/config.js`: 1,654 lines, 895 of them comments - mostly history (dates, versions, player reports). Rule: per setting
one or two lines - what it does and how to tune it; no dates or versions (they are in the README and in git). The class
blocks get the short form they already have for mage and priest (the warrior block is the big one).

Check: the exported config object before and after is compared value by value (JSON of the object, with `character`
faked) - it must be identical. Expected: about 900 lines.

## 3b. travel/ out of core/fighter.js

| New file | From fighter.js | What |
|---|---|---|
| `travel/travel.js` | viaFor, travel, markBadGoal, isBadGoal, goalFor (~330-410) | walks with waypoints (travel.via), skipping goals without a path, stopping a walk to an old goal |
| `travel/rage-walls.js` | rage walls for the path search, the smart_move wrapper (leaveVia legs, walls loosened on "path not found"), keepClearOfZones, holdRingStep, leaveRageZone (~1584-1856) | rage zones as walls; stepping out of a failing zone; the hold ring around an aggressive boss |

The client hooks (smart_move wrapper, can_move) are installed once through `lib/game.js` (new: `hook(name, fn)`), so a
reload never wraps them twice. The fighter keeps calling the same functions; its tick does not change.

3b result: `travel/travel.js` (111 lines) and `travel/rage-walls.js` (300 lines), `lib/game.js` got `smartMove` and
`hook(name, make, once)` (keeps the original as `window.__botOrig<Name>`). Test: `scripts/test-travel.cjs` runs the old
code cut out of the old fighter.js and the new modules through 18 scenarios with the same fake game - identical calls.

## 3c. cave/cave.js and farming/hunts.js with explicit deps

Both already are self-contained files; they get `create(deps, options)` with what they use instead of `ctx`:
- cave: game, util, config.cave, comms, party (manual mode, vote relay, recorder, chests in reach)
- hunts: game, util, config.hunts, comms, party, targeting (spot safety, XP ranking), drops (drop worth)

3c result: `cave/cave.js` and `farming/hunts.js` (moved, same slots `bot_cave` / `bot_hunts`); `main.js` hands them an
explicit deps object with getters (party; targeting and drops are created later) instead of `ctx`. They still use the
client's globals (character, get/set, parent) - the game layer comes with stage 5. Check: old file vs new with `deps.` read
back as `ctx.` - identical except the header and the parameter name.

## Order (one commit and one deploy each)

1. Config comments; deploy; no reload needed (same values) - the next reload picks it up.
2. travel + rage walls; tests for the pure parts (viaFor, bad goals) old vs new; deploy; reload all four (the fighter
   changes) after the usual checks; watch a few team routes, a rage-zone spot (booboos) if one comes up.
3. cave + hunts; tests (hunt choice, Daisy wants, cave vote relay) old vs new; deploy; reload all four; watch a Daisy trip.

## Not in stage 3

The party/targeting/events cycle (stage 4), the rest of the fighter (stage 5), workshop and merchant (stage 6).
