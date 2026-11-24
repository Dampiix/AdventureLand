# Stage 5: fighter.js down to the tick (plan, 2026-11-24)

Status: **done** - step 1 v1.237.12-pilot (game.onSocket), step 2 v1.237.13-pilot (the split). Same branch (`modular-pilot`), **no change in behaviour**. Step 5 of the module plan.

## Where we are

`core/fighter.js`: 1,593 lines, 56 functions, about 60 state variables and start-up statements between them (socket
listeners, comms handlers, the strike object for the warrior, bus values). Travel and rage walls already left in 3b.
It uses ctx.events (9 functions), cave, hunts, supply, gear, targeting, party, teamStats, bus, comms.

## Method (as targeting in 4b and events in 4c)

A generator moves every function verbatim into its part; the parts share one internal state object (`ftr`, unused in
the file today) and call each other through it; outside dependencies come in an explicit deps object. The facade keeps
the state and start-up statements in the old order, after the parts are installed. `combat/fighter.js` is the facade:
deps, the shared state, the tick (`tick`, `busyStep`, `loop`) and the interface (`start`, `stop`) - the tick order
stays exactly as it is.

| Part | Functions | About |
|---|---|---|
| `combat/meters.js` | meterReport, noteTargets, killReport, samplePotions, logDeathAnalysis | the hit / DPS / kill logs (socket listeners), BOT_DPS_REPORT, BOT_KILLS_REPORT, the death analysis |
| `combat/death.js` | handleDeath | respawn, the revive wait, the boss pause on our death |
| `combat/potions.js` | potionGives, healerNear, hpLossRate, handlePotions, resting, topUpFor | potions, solo rest, top-up before a pull |
| `combat/movement.js` | moveTo, goTo, canMoveFrom | walking to a point (no restart for a target that moved a bit) |
| `combat/kiting.js` | orbitPoint, bossAnchor, farmAnchor, boxDist, anchorOut, kiteStep, isForeign, reachOf, inForeignReach, escapePoint, escapePointFrom, spacingStep | kiting and party spacing |
| `combat/passing.js` | unstack, stuckOffTarget, isBossType, leaderGone, startPassing, passThrough | passing through attackers on the way, unstacking |
| `combat/combat.js` | handleCombat | target, class fight hook, basic attack, moving into range |
| `combat/cavalry.js` | cavalryReady, callCavalry, cavalryBlock, guardedCall, cavalryTick | walking to a grown pack and calling the Cavalry |
| `combat/strike-loop.js` | msToAttack, pingComp, fire, strikeLoop, defendInPlace | the strike loop (attacks / heals on time), `ctx.strike` for the warrior |
| `combat/chests.js` | shareGold, chestOpener, chooseOpener, openerAway, lootChests | the chest opener (gold / luck multipliers, `memberLuck` on the bus) |
| `team/formation.js` | endWaitStatus, waitForTeam, toHealer, coverMembers | the leader waits for the team (`teamWaitAt` on the bus), a hurt member walks to the healer, the healer covers members |
| `events/giga-crab.js` | gigaFlee | fleeing a Giga Crab (events.foreignRules) |
| facade | tick, busyStep, loop | the tick, unchanged order |

`core/fighter.js` -> `combat/fighter.js` (same slot `bot_fighter`).

## Page socket listeners -> `game.onSocket`

Six places install a listener on the game page with the same pattern (`PAGE.__botXFn`: take the old one off, put ours
on, so a reload never stacks them): fighter hits, DPS, kills, unstack; targeting in-flight hits; events boss deaths.
New in `lib/game.js`: `onSocket(event, key, fn)` doing exactly that (same `__bot<Key>Fn` names on the page, so a
reload from the old code swaps cleanly). The six places call it; the shared page data (`__botHits`, `__botDps`,
`__botKills`, `__botDeaths`, `__botInflight`) stays where it is.

## Checks

- `scripts/check-split.cjs`: every function identical with `ftr.` removed, statement order kept.
- `scripts/test-fighter.cjs` (new): old vs new in the fake game with the real G and config, a few ticks each: a fight
  on the farm spot (target, attack, kiting / spacing), low HP (potions, rest, the healer), death and respawn, the team
  wait as leader, a chest after a kill, the Cavalry walk, passing through attackers on a route. Records every game
  call, comms message, storage write, status and log line.
- The class tests (warrior uses `ctx.strike`), test-travel, test-targeting, test-events stay green.
- `onSocket`: a unit test (second install takes the first listener off); live: the DPS / kill reports
  (`BOT_DPS_REPORT()`) and the death analysis still fill.

## Order

1. `game.onSocket` + the six places; test; deploy; reload all four after the usual checks; check the reports.
2. The fighter split; checks + tests; deploy; reload the fighters; watch farming, a boss fight, a death if one comes,
   chests, the Cavalry if it is called.

## Result

Twelve parts as planned plus the facade `combat/fighter.js` (~410 lines: deps, the shared state `ftr`, the start-up
statements and the tick functions tick / busyStep / loop in the old order). The facade keeps `ctx` (it sets `ctx.strike`
for the warrior); the parts get deps with getters. One mixed declaration was split by hand (`leaveRageZone`,
`keepClearOfZones` stay in the facade, `holdRingStep` goes on `ftr`). Checks: `scripts/check-split.cjs` (57 of 57
functions identical, statement order kept), `scripts/test-fighter.cjs` (old vs new with the real G, config, party and
targeting, 8 scenarios: farming in range and at a distance, low HP, death and respawn, a member under attack, solo, a
chest, a member following the leader).

## Not in stage 5

Workshop and merchant (stage 6), per-module defaults (stage 7), storage for the headless switch (stage 8). The rage-zone
deadlock and the members' route through spookytown (found 2026-11-24) are behaviour changes - after the rebuild.
