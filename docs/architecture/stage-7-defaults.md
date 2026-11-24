# Stage 7: explicit deps everywhere, defaults in the modules (plan, 2026-11-24)

Status: **7a done** - step 1 v1.237.16-pilot (gear, supply, drops), step 2 v1.237.17-pilot (module views); 7b done - fighter side v1.237.18-pilot, merchant side v1.237.19-pilot. Same branch (`modular-pilot`), **no change in behaviour**. Step 7 of the module plan.

## 7a. The last ctx users get explicit deps

| Module | Today | After |
|---|---|---|
| `core/gear.js` (1,006 lines: equip, wishes, luck swap, value) | `createGear(ctx)`, reads ctx.party, targeting, supply, comms, bus | `gear/` - facade + parts (equip, luck-swap, value) by the generator, deps |
| `core/supply.js` (243) | ctx.party, targeting, gear, cave | `supply/supply.js`, deps |
| `core/drops.js` (574) | ctx.party, targeting, bus | `farming/drops.js`, deps |
| class facades (`classes/<c>/<c>.js`) | build their deps from ctx | take deps |
| targeting, events, fighter, workshop, merchant facades | build deps from ctx inside | take deps |

After 7a only `main.js` knows every module: its `ctx` becomes a plain registry it builds the deps from (getters for
what is created later, as today). Same mechanical check (generator for gear, rename for the others) and the existing
old-vs-new tests, plus a gear test (equip a better item, the luck swap, a wish sent).

7a step 1 result: `gear/` = facade + wishes, equip, luck-swap, weapons, value (67 of 67 functions identical, shared
state `gr`, five shadowing locals checked by hand), `supply/supply.js` and `farming/drops.js` with deps (identical apart
from the header). `scripts/test-gear.cjs`: old vs new, 4 scenarios (equip from the guide, wishes, a better copy, the
merchant's ready ping).

7a step 2 result: instead of rewriting every facade, main.js hands each module `moduleView(ctx, [names])` - an object
with only the modules it uses, read and written through to ctx (getters, so a module created later is there when used;
a setter, so the fighter's `ctx.strike` reaches the warrior). The facades' code is unchanged. `scripts/check-views.cjs`
fails when an entry file uses a ctx field its view lacks, or a module is still created with the whole ctx;
`scripts/test-game.cjs` tests the view.

## 7b. Defaults in the modules, `config.js` keeps only ours

**Mechanism.** Every module factory carries its defaults: `createX.DEFAULTS = { section: { ... } }`. main.js loads
the factories first, fills the defaults into the one config object (only missing keys, deep, never overwriting a value
from config.js; arrays count as one value), then derives the team and creates the modules as today. So there is still
exactly one config object, every module reads it as before - a section read by several modules (`events`, `targeting`,
`party` ...) has one owner that declares its defaults.

**What stays in config.js** (our team and our decisions) and **what moves** (tuning that fits any team):

| Section | Owner module | Stays in config.js | Moves to the module defaults |
|---|---|---|---|
| version, team, otherTeams, phase | main / lib/team | all | - |
| market, dismantle, materialGoals | roles | buy/sell lists, prices, names, goals | scan intervals, shares, minimums |
| gearPlan, gear | gear / workshop | the whole gear plan, noEquip | swap timings |
| events | encounters | search / engage / farmBosses, policy per boss, runner bosses | boss check numbers, timings, scout, Witch's Cipher spots stay ours |
| hunts, drops | farming | allow / deny lists | XP rank, speedups, timings |
| targeting, cavalry | safety / farming | farm, fallback, rare types, Cavalry targets | team-safety numbers, live checks, spot check, rage, mobbing, isolation |
| combat, potions, travel, party, movement, meter, watchdog, ui, tickMs | combat / travel / team / main | via / leaveVia maps | kiting, recover, potion rules, margins, wait times, goal edge, magiport |
| classes | each class | weapon and luck-swap item names, chosen modes | skill thresholds, timings, Agitate numbers |
| elixirs, supply, cave | supply / cave | which elixirs, cave mode | refill levels, timings |
| workshop, merchantRole | workshop / merchant | stand home and prices, Ponty servers, bank keep list, risk tiers, budgets | rhythms, reserves, scan and retry times |

Expected: config.js about 999 -> 450 lines; each module's header lists its settings with one line each.

**Check.** `scripts/check-defaults.cjs`: loads config.js and every module factory in Node, applies the defaults the
way main.js does, and compares the result value by value with the config of the commit before 7b - it must be
identical. It also fails when two modules declare the same key (one owner per setting).

7b mechanism as built (changed from the plan with the user's OK): not the factories' DEFAULTS filled by main.js -
main.js loads only its role's modules, and the merchant reads sections owned by fighter modules (potions ...). Instead
each area has a `defaults.js` next to its modules, and config.js requires them and fills every missing setting at load
(deep, ours always win) - one complete config object for both roles, main.js unchanged. config.js is a bundle now.
Fighter side: `defaults.js` (main), travel, team, combat, encounters, safety, farming, cave, supply and one per class -
config.js 999 -> 702 lines. `scripts/check-defaults.cjs`: values identical, the objects whose key order changed are
listed (none of them is walked in order by the code - checked), no setting in two default files.

Merchant side: `gear/defaults.js`, `roles/workshop/defaults.js`, `roles/merchant/defaults.js`; market, dismantle,
materialGoals and the gear plan are all ours and stay. config.js: 999 -> 626 lines (18 default files, 495 settings). The
only merchant-side object the code walks in order is `merchantRole.give` - unchanged in config.js.

## Order (one commit, one deploy each; reload after the usual checks)

1. 7a gear split + supply + drops with deps; checks + tests; deploy; reload the fighters (merchant too: gear runs there).
2. 7a the facades and main.js take/build deps; tests; deploy; reload all four.
3. 7b fighter-side sections (combat, travel, party, targeting, cavalry, events, hunts, drops, classes, potions, cave,
   supply); check-defaults identical; deploy; reload all four.
4. 7b merchant-side sections (market, dismantle, materialGoals, gear, workshop, merchantRole, elixirs); check-defaults
   identical; deploy; reload the merchant.

## Not in stage 7

Storage with export / import for the Steam <-> headless switch (stage 8); the headless game layer comes after that.
