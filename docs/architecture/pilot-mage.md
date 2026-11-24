# Pilot: the mage as modules (plan, 2026-11-24)

Status: **plan for discussion, nothing built.** Part of [module-plan.md](module-plan.md), step 1 of "Order".

## Goal

Prove the module rules on one real piece before the big rebuild, with **no change in behaviour**:
1. a class made of class-independent skill modules with declared dependencies and their own defaults;
2. the first part of the game layer (`lib/game.js`) and the split of `lib/util.js`;
3. a way to get several source files into the game, measured (load time, size, error traces);
4. modules that also run in Node (first tests with a fake game).

Not in the pilot: the bus messages (their senders - boss tracker, team goal - are rebuilt in later steps), the other
classes, headless, storage sync.

## Today (classes/mage.js, 499 lines)

The class interface the fighter uses: `name`, `survive()`, `always()`, `support()`, `fight(target)`.

| Part | Lines | Uses |
|---|---|---|
| Energize | 15-73 | party, game (players, range, skills, next attack) |
| Reflective Shield | 74-100 | party, game (entities, G) |
| Blaster mode + aim + splash safety | 102-283, fight() | gear (holdWeapons, equipBatch), targeting (packVerdict), events (current), cave, util (kiteRisk, courageOf, attackersOnMe, weaponPower, isDoublehand, noArea, foreignOnlyBlocks, mpRatio) |
| Team Magiport | 285-385 | party (teamGoal, atGoal, goalLabel, wasAtGoal), events (searchJob), cave |
| Blink on routes | 386-446 | game (smart plan, can_move_to), party (teamGoal), targeting (inSpotArea, farmNow) |
| Mana Burst | fight() | off in config |

## Target

```
bot/lib/game.js            browser game layer, first part: only what the mage needs (see below)
bot/lib/geometry.js        xy, distanceTo, boxes ...            } split out of util.js;
bot/lib/items.js           findItemIndex, weaponPower, isDoublehand } util.js stays as a facade that
bot/lib/names.js           shortName, teamPrefixes               } re-exports exactly the same 61 names,
bot/lib/status.js          status, SHORT table                   } so no other module changes
bot/lib/storage.js         get/set with prefix, journal          }
bot/lib/combat-math.js     hit factor, mobbing, fear, kiteRisk   }
bot/lib/util.js            facade (re-exports) + what is left
bot/classes/mage/mage.js        the class: what it is, which skills; builds their deps from ctx
bot/classes/mage/energize.js    createEnergize(deps, options) -> { tick }
bot/classes/mage/reflect.js     createReflect(deps, options) -> { tick }
bot/classes/mage/blaster.js     createBlaster(deps, options) -> { tick, fight(target) }
bot/classes/mage/blink.js       createBlink(deps, options) -> { tick }
bot/classes/mage/team-port.js   createTeamPort(deps, options) -> { tick }
```

`mage.js` keeps the class interface unchanged, so `main.js` and `fighter.js` stay untouched:
`always()` = team-port, blaster, blink ticks; `support()` = reflect, energize; `fight()` = blaster aim, then burst.

### Dependencies per skill (passed in, nothing taken from ctx)

| Skill | deps | options (defaults in the module = today's config values) |
|---|---|---|
| energize | game, party.memberNames, log | enabled, energizeBelow, energizeAbove, burstLeadMs |
| reflect | game, party.memberNames, log | enabled, keepMp, minAttack |
| blaster | game, gear.holdWeapons/equipBatch, party.memberNames, safety (packVerdict, kiteRisk, courageOf, attackersOnMe, noArea, foreignOnlyBlocks), isBoss(m), bossEventActive(), mode (cave/manual), items, log | the `blaster` block |
| blink | game, teamGoal(), inSpotArea(), farmType(), mode, log | enabled, minDist, keepMp |
| team-port | game, party (memberNames, teamGoal, atGoal, goalLabel), searchActive(), mode, fighters, tankClasses, log | the `magiport` block |

`mage.js` builds these deps from `ctx` with small getters, because `ctx.targeting` and `ctx.gear` are created after the
class today. Later steps replace the getters with the real modules.

### `lib/game.js`, first part

Thin wrappers, no logic: `me()` (character), `G`, `entities()`, `player(name)`, `partyInfo()`, `useSkill(name, target,
extra)`, `canCast(skill)`, `inRange(entity, skill)`, `onCooldown(skill)`, `nextAttackAt()`, `itemProps(item)`,
`equipBatch`, `unequip`, `changeTarget`, `attack`, `path()` (the current smart_move plan), `canMoveTo(x, y)`,
`targetedMonster()`, `nearestMonster(filter)`. A headless version later implements the same names.

## Getting the files into the game: per-slot bundles

Each slot keeps its name; a slot may now be built from several files. `slots.json` gets an `entry` per slot, and the
deploy script bundles the entry with its local `require("./x.js")` files into one file before the upload:
- slot 28 `bot_class_mage` = `classes/mage/mage.js` + its 5 skills;
- slot 22 `bot_util` = `lib/util.js` + the split-out libs + `lib/game.js`.

So `main.js` and every other module keep loading `require_code("bot_class_mage")` and `require_code("bot_util")` as
today - the migration can go slot by slot, and later the slots can be merged into the 2-3 role bundles.

Bundler: **a small one of our own in `scripts/` (about 80 lines, no dependency)** - each file becomes a function in a
small module table, `require("./x.js")` inside the bundle resolves to it, every part starts with
`// ---- classes/mage/blink.js` so in-game errors can be traced, comments can be stripped on upload. The source files
stay plain CommonJS (`module.exports`, `require("./...")`), which runs in Node too. esbuild stays an option if ours is
not enough (it needs an npm install).

Measured in the pilot: bundle sizes; start time from `bot_main` to the first tick before and after; that an error inside
a skill shows the right file in the game log.

## Tests (Node, no game)

`scripts/test-mage.mjs` with a fake `game` (a character, a few players and monsters, a fake party): team-port pulls the
tank first and never someone seen at the goal; blink never jumps into a spot; energize gives MP to the lowest member;
reflect picks the member with the most magical attack on it. Run before every deploy.

## Steps

1. Bundler + `slots.json` entries + deploy script (dry run: the bundle of today's single files must equal the files).
2. Split `util.js` into the libs + facade; a check that the facade exports exactly the same 61 names. Deploy, reload
   all four (after the usual checks: no live boss event, merchant not on a trip), watch 30 min.
3. `lib/game.js` first part.
4. Mage split into class + 5 skills with deps and defaults; the mage part of `config.js` keeps today's values (comments
   shortened as the sample for the config rule). Tests. Deploy, reload the mage, watch 1-2 h: blink, ports, energize,
   reflect and Blaster lines in the journal and the log as before.
5. Report: sizes, start time, what worked, what to change in the plan; decide the deploy way for the rest.

## Done when

- The mage behaves as before (same journal and log lines, no new errors) for 1-2 h with at least one team route.
- No skill module reads `ctx` or game globals directly; each is under ~250 lines.
- `main.js`, `fighter.js` and the other classes are unchanged.
- The tests run in Node.
- We know the start time and sizes and have decided how the rest is deployed.

## Branch and way back

The pilot runs on its own branch **`modular-pilot`** (from `bot-v1` at f5e45d1, player decision). Every step is one
commit there; `bot-v1` keeps today's working bot.

The game itself has only one set of CODE slots: what is running is what was uploaded last, whichever branch it came
from. Way back to today's bot: `git checkout bot-v1`, deploy (`--force` if the pilot's upload counts as an in-game edit
for the deploy state), reload all four after the usual checks. Fixes for the running bot during the pilot are made on
`bot-v1` and then merged into `modular-pilot`, so the pilot never deploys an older state of the other modules.
