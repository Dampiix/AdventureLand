# Stage 4: break the party / targeting / events cycle, then split targeting and events (plan, 2026-11-24)

Status: **plan, not built.** Same branch (`modular-pilot`), **no change in behaviour**. Step 4 of the module plan.

## Where the cycle is (measured on v1.237.8-pilot)

| From | Uses | What |
|---|---|---|
| party (391 lines) | targeting | `inSpotArea`, `watchPoint` - is a point at the farm spot (team goal "spot", travelDest) |
| party | events | `current()`, `searchJob()` - the leader's goal is the boss or a search |
| party | cave | `active()`, `ownManual()` - no goal under manual mode; manual flag in the broadcast |
| cave | party | `leaderInfo`, `memberNames` - vote relay |
| events (1,229) | party | inParty, teamGoal, memberNames, goalLabel, wasAtGoal, ... (22 uses) |
| targeting (2,173) | party | enabled, isMember, detached, memberNames, ... (58 uses) |
| targeting | events | `teamStats` (10 uses), `soloOk`, `cipherFarm`, `current` |

So: party <-> targeting, party <-> events (through party), party <-> cave. events never calls targeting directly.
Side channels: `ctx.teamWaitAt` (fighter -> events), `ctx.memberLuck` (fighter -> drops).

## 4a. Break the cycle (small; party becomes a lower module)

1. **`safety/spots.js`** (new, pure: config, util, game): `inSpotArea`, `watchPoint`, `spotBox`, `boxDist` move out of
   targeting. Targeting and party both use it -> party no longer needs targeting.
2. **`lib/bus.js`** (new, ~40 lines): `provide(name, fn)` / `get(name)` for current state, `on(name, fn)` / `emit(name,
   data)` for later messages. Read on demand, exactly like the calls today, so the timing does not change.
   - events provides `boss` (= `current()`) and `search` (= `searchJob()`); party's `leaderGoal` reads them.
   - cave provides `manual` (`active()`, `ownManual()`); party reads it.
   - fighter provides `teamWait` (instead of `ctx.teamWaitAt`), `memberLuck` (instead of `ctx.memberLuck`).
3. **`team/team-stats.js`** (new): `shareStats`, `teamStats`, `teamLevel` out of events (member stat reports via comms).
   Targeting and events use it -> targeting no longer needs events for the team model.
4. `core/party.js` -> `team/party.js` with explicit deps (config, util, comms, game, bus, spots).

After 4a: party -> spots, bus; cave -> party; events -> party, cave, team-stats; targeting -> party, events (soloOk,
cipherFarm, current - fine, no way back), team-stats, spots, cave, hunts, drops. No cycle.

Check: mechanical (moved function bodies identical), the bus read where the call was (same order), test old vs new for
the team goal (leaderGoal with a boss, a search, manual, a spot), live: a boss goal, a search, a spot goal.

## 4b. Split targeting (2,173 lines) into parts

The functions are tightly knit (liveSafe -> holdBoss -> aggressive -> packOk -> teamVerdict ...), so like the warrior in
stage 2: parts that share one internal state object `t`, installed with `install(t, deps)`; cross-part calls go through
`t.fn()`. `targeting.js` stays the facade with the same interface - nobody outside notices.

| Part | Functions (from the call graph) |
|---|---|
| `safety/deaths.js` | saveExperience, provenByUs, recentDeath, clock, diedAt, deathAt |
| `safety/team-safety.js` | ownSafe, harmless, shareSafe, teamModelOn, densePack, potions, teamVerdict, packVerdict, packOk, joinsFights, aggressive, soloRouteSafe, pullVerdict |
| `safety/live-safety.js` | liveSafe, mobGuard, onFighter, liveDanger, doomed targets (isCoop, diesSoon, doomed, skipDoomed, in-flight hits) |
| `safety/rage-zones.js` | rageZones, zoneAt, zoneVerdict, rageBoxes, failingZoneNear/At, rageZoneHere, rageBlocks |
| `safety/spot-check.js` | gateApplies, spotGate, spotGateWatchNow, judgeSpot |
| `safety/boss-hold.js` | bossList, bossBox, bossHoldRing, teamAt, holdsFor, tooStrongAlone, holdBoss, heldBossNear, holdBossQuiet |
| `farming/spots-taken.js` | strangersNear, occupiedSpots, inOccupied, busyShare, fightersNear, releaseFreedSpots, checkOccupied, allSpotsTaken, spotFor, markCrowded, reportSearch |
| `farming/farm-choice.js` | objector, lastingObjector, isTeamSafe, whyUnsafe, calcXp, walkable, teamXpRanking, fromProgression, eventMonsters, currentFarm, farmList, farmBlocked |
| `farming/cavalry-plan.js` | cavalryReady, cavalryCalledAt, huntResetSpot, cavalryEdge, cavalryPlan, saveStrong, cavalryNext, tooStrongHere |
| `farming/target-pick.js` | standPoint, crowdAround, isolated, safeCandidates, nearestSafe, explainNone, waitForLone, isOurs, isEasy, isValid, nearestPartyAttacker, rareTarget, luckCatcherNear, pick, pickInner |

Made by a generator script (like the warrior's), so every function body is copied verbatim with `t.` in front of calls to
other parts. Check: a script proves each body equal to the old one modulo `t.`; a test with a fake game for pick,
currentFarm, liveSafe, spotGate old vs new; live a few hours (farm choice, spot checks, Cavalry, a boss hold).

## 4c. Split events (1,229 lines)

Same way, `events.js` stays the facade:

| Part | Functions |
|---|---|
| `encounters/boss-check.js` | assessBoss, canBeat, soloOk, canSolo, policy, liveEntries, observe |
| `encounters/boss-tracker.js` | killedAt, watchBossDeaths, visibleBoss, bossInfo, infoText, outcome, reportBossDeaths, reportSightings, fighterAt, memberSighting, bossBusy |
| `encounters/boss-search.js` | watched, everyMs, searchLater, respawnLater, spawnSpots, splitAreas, runner (endRunner ... checkRunner), scout plan (scoutAvailable, scoutTakes, publishScoutPlan), soloKill |
| `events/witch-cipher.js` | cipherWindow, cipherFarm, cipherActive |
| `team/team-port.js` | portWhyNot, acceptMagiport (consent; uses party and the bus `boss`) |
| `encounters/encounters.js` | decide, tick, onOwnDeath, teamWaiting, walkTo - the per-tick flow |

`monsters/<type>.js` (per-boss settings) waits until the encounters part exists - it needs the plan message, a feature
change, so after the rebuild.

## Order (one commit, one deploy, a reload of all four each)

1. 4a cycle break; tests; deploy; reload after the usual checks; watch a boss goal, a search, a spot goal.
2. 4b targeting parts; mechanical check + tests; deploy; reload; watch farm choice / spot checks for a while.
3. 4c events parts; mechanical check + tests; deploy; reload; watch a boss search and a kill.

## Not in stage 4

The fighter's page socket listeners (`PAGE.__botHits`, `__botDps`, `__botKills`, targeting's in-flight hits) -> a
`game.onSocket` helper with stage 5 (fighter down to the tick). Per-module defaults (stage 7).
