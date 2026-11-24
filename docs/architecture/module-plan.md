# Module plan (final, 2026-11-24)

Status: **agreed plan, not built yet.** Next step: the mage pilot (see "Order").
Interactive map: [module-map.html](module-map.html) (98 modules, 276 dependencies, no cycles; open it in a browser).

Goal (player decision): every feature of the bot is a self-contained module with a clear interface - the project is
easier to read and to work on for both of us, and a feature can be lifted into a fresh bot and work there. One topic per
file, about 200-600 lines; not every function gets its own file. Model: earthiverse's `adventureland-bots`
(`strategy_pattern/`: 37 strategies as building blocks, 65 setups - one per monster - that pick the strategies and their
options per class), less fine-grained.

## Today

22 files, ~20,000 lines, 1.23 MB, CODE slots 20-41 (Viz). Every file is `createX(ctx)`; `main.js` fills one shared `ctx`
and every module reaches every other one through it.

| File | Lines | Uses from ctx |
|---|---|---|
| roles/workshop.js | 4,282 | comms, config, util |
| core/targeting.js | 2,173 | cave, comms, config, drops, events, hunts, party, util |
| core/fighter.js | 1,940 | 13 others (everything) |
| classes/warrior.js | 1,606 | config, events, gear, party, strike, targeting, util |
| roles/merchant.js | 1,375 | comms, config, scout, util, workshop |
| core/events.js | 1,229 | cave, comms, config, party, teamWaitAt, util |
| core/gear.js | 1,006 | comms, config, supply, util |
| lib/util.js | 819 | - (grab bag) |
| config.js | 1,673 | - (907 lines are comments) |

Problems: the cycle party <-> targeting <-> events; side channels (`ctx.teamWaitAt`, `ctx.memberLuck`, `PAGE.__bot...`);
game globals used everywhere; one config with a changelog in its comments.

## Rules for every module

1. **Public interface**: documented functions plus the bus messages it sends. Nothing else is used from outside.
2. **Declared dependencies**: `createX(deps, options)` - it gets what it needs and does not search `ctx`. Optional
   dependencies may be missing; the module then does less (the team port without a party: nothing).
3. **Own defaults** in the module; `config.js` only holds our overrides.
4. **Own names**: message types (`comms`) and storage keys carry the module's prefix.
5. **No cycles**: dependencies point down, or sideways inside a layer without a cycle. Where a cycle would form, the
   lower module sends a bus message instead (six messages, see below) - the bus is used sparingly, everything else is a
   plain call.
6. **All game access through `lib/game.js`** (see "Game layer").
7. **A short header**: what it does, interface, options, a minimal "fresh bot" example.

## Classes and skills

A class only knows *what it is* (ranged, kites, tank ...) and *which skill modules it has*; a skill module knows how its
skill works and asks only "do I have this skill and may I use it now?" - never "am I a mage?". A new class with Blink
plugs in the same `blink.js`. Skills from items (Knife Belt: Fan of Knives) are plugged in while the item is worn.
The fighter tick asks the class for its own work; it does not know the class. Small skills with one purpose are grouped.

| Class | Skill modules |
|---|---|
| warrior | agitate, area (Cleave + Stomp), mobility (Charge + Dash), taunt, defense (Hardshell + Warcry), sword-swap |
| mage | energize, reflect, blaster, blink, team-port |
| priest | heal (single + party), curse, support (Absorb + Dark Blessing), revive; luck-swap from gear/ |
| ranger | shots (Supershot, Hunter's Mark, Poison Arrow) |
| rogue | stealth, rogue-buffs (Rogue Speed + Poison Coat), mentalburst, fanofknives (item skill) |
| paladin | selfheal, mana-shield (+ Guardian's Oath), smash, cleansing |

The merchant is a role with its own tick and parts (stand, fishing, elixirs, ponty, buy-orders, mluck, scout) plus the
workshop parts (bank, budget, crafting, compound, upgrade, dismantle, material-goals, exchange, gear-goals, value-report).

## Encounters: one module per monster when needed

- `encounters/` core: which encounter is active; `boss-tracker` (sightings, current boss, kill booking) and
  `boss-search` (search, split search, runner, merchant scout plan) are shared by all bosses.
- `monsters/<type>.js` exists **only when a monster needs something special** (e.g. fire spirits: fire resistance
  elixir first); otherwise `monsters/default.js` applies - what the bot does everywhere today. Bosses are monsters too
  (phoenix, mvampire, fvampire, skeletor, jr, greenjr, snowman; later icegolem ...).
- A monster module sets: how to find it, whether the team may take it and who may open (Phoenix alone yes, Dracul
  no), a fight plan per role (hold distance, stance, forbidden skills such as Blaster or Agitate, flee rules) and special
  phases. Classes and skills only read the plan ("may I?"); no class knows a single monster.
- **General rules stay general**: safety check, rage zones, mobbing guard, "clear of other kinds before Agitate" protect
  every spot; they are never copied into monster files. An exception that repeats across many monsters becomes a rule.
- `events/` for time events: witch-cipher, giga-crab (join spot, 1hp phases, priest never attacks, flee), goo-brawl,
  graveyard. Their settings move out of `config.js` into the module.

## Game layer, headless and the Steam client

`lib/game.js` is the only place that touches the game: character, entities, `G`, moving and path search, skills, items,
socket listeners and our hooks into the client (`smart_move` wrapper, rage walls in the path search, `cave_request`).
Two versions:
- **browser** - the Steam / web client as today;
- **headless** (later) - our **own Node.js client** as planned in [../headless/PLAN.md](../headless/PLAN.md) (decided
  2026-11-21: no ALClient, own pathfinding in plain JavaScript, no hidden browser): no client, no CODE slots, code runs
  from the project folder. That plan already moves the browser-only parts "behind a small runtime module" - this game
  layer is that module. Its open points stay there (login of a Steam-created account, `authfail`, socket limits).

Watching: the official client can **observe** a headless character (observer mode with the character's `secret`; the
running bot is not kicked - see the headless plan). Besides that the player wants to be able to stop headless and run
the same bot in the Steam client. So the browser build stays available, and **`lib/storage.js` carries the saved state
across** (journal, boss search times, drop and gold statistics, workshop state): browser storage or a file, exported and
imported on a switch. Mixed operation (one character in Steam, the others headless) works: the characters talk through
server messages either way. Limits: one account online at a time, at most 3 fighters + 1 merchant.

## Getting the code into the game (decided later)

The structure comes first. Two ways to load it, compared in the pilot:
- one CODE slot per file (~100 of the 100 numbered slots - too tight with the skill modules);
- **bundling** (e.g. esbuild): normal `import`/`export` modules in the project, one bundle per role (fighter, merchant)
  without comments plus `config` as its own slot = 3 slots, far below the 1 MiB per slot (the code is 1.23 MB with
  comments today). Each module is marked in the bundle (`// ---- classes/mage/blink.js`) so in-game errors can be traced.
  The same modules run in our own Node client for headless and for tests.

## Layout

```
bot/main.js                 composer: loads modules once, wires deps, starts the role's tick
lib/        game.js  config.js  bus.js  comms.js  storage.js  status.js  names.js  geometry.js  items.js  combat-math.js
travel/     travel.js (waypoints, bad goals)  rage-walls.js
team/       party.js  team-goal.js
safety/     team-safety.js  rage-zones.js  spot-check.js  mobbing-guard.js
farming/    farm-choice.js  target-pick.js  drops.js  hunts.js
combat/     fighter.js (tick only)  kiting.js  potions.js  strike-loop.js  chests.js  cavalry.js
gear/       equip.js  wishes.js  luck-swap.js  gear-value.js
supply/     supply.js
cave/       cave.js
encounters/ encounters.js  boss-tracker.js  boss-search.js
events/     witch-cipher.js  giga-crab.js  goo-brawl.js  graveyard.js
monsters/   default.js  phoenix.js  mvampire.js  fvampire.js  skeletor.js  jr.js  greenjr.js  snowman.js
classes/    <class>/<class>.js + skill modules (table above)
roles/      merchant/ (merchant.js tick, stand, fishing, elixirs, ponty, buy-orders, mluck, scout)
            workshop/ (bank, budget, crafting, compound, upgrade, dismantle, material-goals, exchange, gear-goals, value-report)
```

## Bus messages

| Message | Meaning | Sent by | Heard by |
|---|---|---|---|
| boss | current boss changed (found, killed, gone) | boss-tracker | encounters, team-goal, farm-choice, fighter |
| goal | new team goal, or the leader arrived | team-goal | blink, team-port, fighter |
| search | a boss search runs or ended | boss-search | team-goal, scout |
| plan | fight plan of the active encounter | encounters | skills (blaster, agitate, area, curse, shots, fanofknives), kiting, target-pick, fighter |
| cipher | Witch's Cipher gathering window open/closed | witch-cipher | farm-choice |
| manual | cave or /manual on/off | cave | skills, supply, team-goal, fighter |

## Features worth sharing

Team goal + team magiport + blink travel; boss tracker + search; safety model (team safety, rage zones); upgrade planner;
monster hunts; Ponty and market tools; Cave of Many Dreams helper (13 modules marked in the map).

## Config

One file, but short: per setting one or two comment lines - what it does and how to tune it. No dates, versions or
player reports (the history is in the README and in git). Expected ~900 instead of 1,670 lines; shorter again once the
event and monster settings live in their modules. A safe first step: no behaviour change.

## Order (each step keeps the behaviour; deploy, watch, git makes it reversible)

1. **Pilot**: `lib/game.js` (first part), `bus.js`, split `util.js`; the mage as class + 5 skill modules. Measure loading
   (slots vs bundle) and decide how to deploy.
2. **Config comments** shortened (any time, no behaviour change).
3. **Leaves**: status, travel + rage walls, cave, hunts, the other classes' skills.
4. **Break the cycle**: team state on the bus; party, events, targeting read it instead of each other; then split
   targeting (safety / farm choice / target pick) and events (encounters / tracker / search / events / monsters).
5. **fighter.js** down to the tick; combat helpers out.
6. **workshop / merchant** into their parts.
7. **Per-module defaults**; `config.js` keeps only overrides.
8. **Storage** with export/import for the Steam <-> headless switch; later the headless game layer.
9. Optional: tests with a fake game for the pure modules.
