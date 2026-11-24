# Study: earthiverse's adventureland-bots (headless, on ALClient)

Status: read-only study, 2026-11-24. Nothing was built.

Source: local clone of `github.com/earthiverse/adventureland-bots` (latest commit `b27ecfd`, 2026-11-22, "fix: cap per-bot server hop wait and skip setups while hopping"). The clone is shallow, so file history is not available. All paths below are relative to the repo root. `source/archive` was skipped. The library ALClient was only opened where a call needed explaining. The game server source (`kaansoral/adventureland_mongodb`) was used to check one protocol detail (`o:command` → `code_eval`).

Things marked **(unverified)** could not be confirmed from the code.

---

## 0. Overview

| Item | What it is |
|---|---|
| Language / runtime | TypeScript, ES modules, compiled with `tsc` (`package.json` `build` script). `bun.lock` is present, so he may run it with bun **(unverified)**. |
| Library | `alclient` ^0.26 (his own headless client: socket, world state, pathfinder, Mongo models). |
| Main entry | `source/earthiverse.ts` (1407 lines). It got the latest fix, so it is most likely what he runs. |
| Alternative entry | `source/earthiverse/index.ts` (526 lines): the same building blocks, but it swaps whole character sets per server. Which of the two runs today is **unverified**. |
| Public launcher | `source/public/server.ts` + `runner.ts` + `index.html`: a web form where other players paste their user ID and auth code, and a child process runs their characters with his strategies. |
| Other entry points | Event scripts (`christmas/`, `halloween/`, `valentines/`, `crabrave/`), `merchant/deal_finder.ts` (merchant server hopper), `tools/data_collector.ts` (observers on every server), `tests/discord/*` (a Discord bot for market/character lookups). |
| Size | ~42k lines without `archive`. The biggest files are `merchant/strategy.ts` (3195), `base/itemsNew.ts` (1711), `earthiverse.ts` (1407), `strategies/move.ts` (1165). |

The architecture has three layers:
1. **ALClient**: one object per connected character (`Warrior`, `Merchant`, ...), with live state (`bot.entities`, `bot.players`, `bot.chests`, `bot.S` server info) and promise-based actions.
2. **Strategist / Strategy** (`source/strategy_pattern/context.ts`): a wrapper per character that runs named loops and owns reconnects and server changes.
3. **A team planner** in the entry file: every second it chooses, for every free character, an `attack` and a `move` strategy from per-monster "setups". It also decides server hops.

---

## 1. Process layout: start, keep alive, restart, reconnect, credentials

### One process for the whole team
`earthiverse.ts` logs in once, loads G and prepares the pathfinder (`earthiverse.ts:91-92`). It then starts every character in the same Node process: merchant first, then warriors, mages, paladins, priests, rangers and rogues (`earthiverse.ts:945-1087`). The team is hard-coded at the top (`earthiverse.ts:119-128`). At most 3 attackers are allowed (`:134`). The first attacker in the list is the party leader (`:128`).

Each `start<Class>Context` catches a failed login, disconnects, and tries again after 10 s with `setTimeout` (e.g. `earthiverse.ts:985-999`). There is no retry limit for his own characters.

The public launcher (`source/public/server.ts:36-113`) is different. It **spawns one child process per web form submission** (`spawn(process.execPath, [runner.js, base64 payload])`, `:86-90`). Inside that child, every character runs an endless "connect, wait until stopped, clean up, wait 5 s, connect again" loop (`public/runner.ts:373-434`). Before connecting, the loop checks `updateServersAndCharacters()`: if the character is unknown it waits 30 s, and if it shows as online it waits 10 s (`:379-391`). Characters start 2.5 s apart (`:475-481`).

### Reconnect lives in the Strategist
`Strategist` (`strategy_pattern/context.ts:56-436`) owns the bot object:
- On every socket `disconnect` it calls `reconnect()` (`context.ts:169-173`).
- `reconnect()` builds a **new** ALClient character object for the same character ID and server and connects it (`:350-412`). On success it swaps the object in with `changeBot`, which re-runs `onApply` for every strategy so their socket listeners move to the new socket (`:159-181`).
- The retry delay depends on the error text (`getRetryDelayMs`, `:233-241`): `wait_N_second` → N s + 2 s; `limits` → `RECONNECT_TIMEOUT_MS` (40 s in ALClient `Constants.ts:9`); `ingame` → 0.5 s; `nouser` → fatal (the context stops); anything else → 10 s.
- An attempt counter (`connectAttempt`) cancels older attempts when a newer reconnect or server change starts (`:243-246`, `:271`, `:278-282`, `:351`). `changeBot` always disconnects the previous bot object, "so we never leak a second active socket" (`:160-163`).
- `changeServer(region, id)` uses the same mechanism with a different target server (`:243-329`).
- `stop()` clears all timers and disconnects for good (`:423-430`).

### Process restart
- The `restart` admin command and SIGINT run `saveAndExit()`. It writes the running *public* characters (owner, auth, character ID, settings) to `public.csv` and calls `process.exit(0)` (`earthiverse.ts:289`, `:312-316`, `:343-356`). At the next start, `public.csv` is read back and those characters are restarted (`:1325-1346`).
- Something outside the repo must bring the process back after `exit(0)`. No pm2/systemd/docker file is in the repo **(unverified how he does it)**.
- There is a global `unhandledRejection` logger (`earthiverse.ts:87-89`). The public runner also logs `uncaughtException` and keeps running (`public/runner.ts:32-38`).

### Config and credentials
- `credentials.json` in the repo root (gitignored as `credentials*.json`): `email`, `password`, optionally `mongo` (connection string), `userID`/`userAuth`, and `discord.auth` for the Discord bot (`credentials.json.sample`, `tests/discord/bot.ts:7,20`).
- ALClient's `loginJSONFile` connects Mongo first. It reuses a stored `userAuth` and writes a fresh auth back into the same file after a new login (ALClient `Game.ts:244-246`, `:272-310`).
- All tuning is TypeScript constants and option objects: toggles (`earthiverse.ts:95-117`), default server (`base/defaults.ts:3-4`), item policy (`base/itemsNew.ts`, `DEFAULT_ITEM_CONFIG`). There is no separate runtime config file. Live changes go through in-game commands (section 6).

---

## 2. Strategy pattern: how behaviour is composed

### Building blocks
| Concept | Where | Meaning |
|---|---|---|
| `Strategy<T>` | `context.ts:48-54` | An object with optional `loops` (a Map `LoopName → {fn, interval}`), `onApply(bot)` and `onRemove(bot)`. |
| `LoopName` | `context.ts:15-43` | A fixed list of names (`attack`, `move`, `heal`, `loot`, `party`, `partyheal`, `sell`, `buy`, `upgrade`, `compound`, `mluck`, ...). **One loop per name per character**: if a new strategy brings a `move` loop, it replaces the running `move` loop (`context.ts:91-98`). |
| Loop interval | `context.ts:6-7`, `:125-144` | Either a number of ms, or a list of skills. With skills, the next run waits for the shortest cooldown of those skills, at least 50 ms (e.g. `attack` loops on `["attack","zapperzap"]`, `heal` on `["use_hp"]`). |
| Loop runner | `context.ts:108-147` | Each loop is its own `setTimeout` chain. A run is skipped while `bot.ready` is false. Exceptions are logged and the loop continues. |
| `Strategist<T>` | `context.ts:56` | Per character: the set of applied strategies, the loops, timers, reconnect and server change. |
| `filterContexts` | `context.ts:445-462` | Returns the ready contexts, optionally only those of one owner or one server. Used everywhere for teamwork. |

### Composition per character
- **Base strategies for every class** (`earthiverse.ts:883-908`): debug log, party accept/request, admin/override commands, buy/sell/item (private characters only), home server, avoid death, booster, respawn, tracker, elixir, destroy, upgrade statistics, temporal surge.
- **Class extras** (`earthiverse.ts:910-942`): mage → magiport strategies, priest → party heal, rogue → rogue speed, warrior → charge.
- **The class-specific combat** lives in `strategies/attack_<class>.ts`. They all extend `BaseAttackStrategy` (`strategies/attack.ts:102`), which handles target choice with a priority queue, courage limits (`:334-353`), "greedy aggro" on new `entities` events (`:168-258`), zapper kill-steals (`:146-167`), auto-equip of a loadout (`ensureEquipped`, `:410+`), energize from a team mage (`:655-669`) and overkill prevention (`:680-687`). Each option is a flag (`disableX`, `enableGreedyAggro`, `maximumTargets`, ...) (`:35-53`).
- **Move strategies** (`strategies/move.ts`): `BasicMoveStrategy`, `FollowFriendMoveStrategy`, `HoldPositionMoveStrategy`, `ImprovedMoveStrategy` (farm a spawn), `SpreadOutImprovedMoveStrategy`, `KiteInCircleMoveStrategy`, `MoveInCircleMoveStrategy`, `SpecialMonsterMoveStrategy` (find a boss through own sight, teammates' sight, server info, then the Mongo DB, `move.ts:591-712`), `KiteMoveStrategy`, `KaneEventBossMoveStrategy`.

### Setups per monster
`strategy_pattern/setups/<monster>.ts` (about 60 files) each export `construct<Monster>Setup(contexts)`. It returns a `Setup = { configs: Config[] }` (`setups/base.ts:83-139`):
- A `Config` has an `id` and a list of `CharacterConfig`s.
- Each `CharacterConfig` names a `ctype`, the `attack` and `move` strategy instances, and optional `require` (level, attributes, items).
- Configs are listed **from best to worst team composition**. Example `phoenix.ts:77-100`: triple mage → mage+priest+warrior → priest+warrior → solo mage → solo rogue. The attack options carry the monster-specific tuning: loadout attributes and preferred weapons (`generateEnsureEquipped`, `phoenix.ts:22-27`), `enableGreedyAggro`, `disableEnergize`, `enableEquipForCleave`, ...
- `constructGenericSetup(contexts, monsters)` gives every class a default config for simple monsters (`setups/base.ts:141-262`). It picks loadout attributes from the monsters' `damage_type`.
- `constructSetups` maps every monster name to its setup (`setups/base.ts:387-494`). `constructHelperSetups` is a weaker variant for public (guest) characters (`:496-569`).

### The planner
`contextsLogic` runs every 1 s (`earthiverse.ts:805-879`):
1. Characters that are not ready or are about to hop are skipped. Event tasks (anniversary, holiday spirit, monster hunts) take a character out of the setup system and give it a dedicated strategy (`:815-864`).
2. `applySetups` (`:364-645`) builds a **priority list of monster names**: live event bosses from `bot.S` (`:444-537`), special monsters seen nearby or recently in the DB (`:539-597`), a manual override (`:600-604`), monster hunts (`:606-627`), and the defaults (`:630-632`).
3. For each monster in order, it tries that monster's configs until one can be filled with the still-free characters (`isDoable`, `:369-401`, checks ctype, level, attributes, items). It then swaps only the `attack`/`move` strategies that changed. When the move strategy changes, it stops a running smart move (`:403-439`).

`strategy_pattern/runner.ts` is a simpler single-character variant. Its `logicLoop` swaps between whole strategy lists: holiday spirit, bank when full, buy replenishables, otherwise farm (`runner.ts:248-292`).

### Compared with our modules
| Ours (bot/) | Theirs | Note |
|---|---|---|
| One fighter tick that calls modules in order | Many independent timer loops per character, each with its own interval or cooldown | Their loops never block each other: a slow `smartMove` in `move` does not delay `attack` or `heal`. A tick is easier to reason about, but one slow step delays everything. |
| `classes/<class>/` skill modules | `attack_<class>.ts` subclasses of `BaseAttackStrategy` + small class strategies (charge, partyheal, rspeed, magiport) | Similar split. They put all per-class combat into one class with option flags. |
| `encounters/` + per-monster encounter idea (`monsters/`) | `setups/<monster>.ts` with ranked team compositions and requirements | Very close to our idea. The ranked "config per composition" with `require` is worth copying. |
| Leader decides the target, members follow through messages | A central planner function with direct access to all characters | Possible for us headless only if the planner can see all characters at once (see section 3). |
| `defaults.js` per module (stage 7b) | Option objects with defaults per strategy (`DEFAULT_PARTY_HEAL_STRATEGY_OPTIONS`, `partyheal.ts:20-24`; `defaultNewMerchantStrategyOptions`, `merchant/strategy.ts:1482-1498`) | Same idea. |
| Item rules in config | One `ItemConfig` table per item: `hold`, `replenish`, `holdSlot`, `buy`/`buyPrice`, `sell`, `upgrade`, `exchange`, `destroy`, `mail`, `craft` (`base/itemsNew.ts:6-65` ff.), with predicates `wantToHold`, `wantToSellToNpc`, `wantToDestroy`, `wantToUpgrade`, ... (`itemsNew.ts:1076-1259`) and a sanity check (`:1311`) | A single declarative item table that all roles read. |

---

## 3. Coordination between characters

**Everything is direct object access in one process.** There are no messages between his own characters and no shared key/value store. Each strategy gets the shared `contexts` array and reads or even *drives* the other characters' bot objects:

| Behaviour | How | Where |
|---|---|---|
| Party | Members send `sendPartyRequest(leader)` every 2 s until they are in the party. The leader accepts requests from an allow list. | `strategies/party.ts:11-59`; `earthiverse.ts:177-178`, `:885-888` |
| Chest looting | Among own characters in range, the one with the highest `goldm` opens the chest. A shared LRU stops double opens. Chests are cached per server across a hop and restored. | `strategies/base.ts:143-168`, `:11-12`, `:40-70` |
| Overkill prevention | When a character can one-shot a target, it **deletes that entity from the other characters' entity maps** so they pick something else. | `attack.ts:680-687` |
| Energize | The attacker looks for a team mage in range and calls `mage.energize(...)` **on the mage's object**. | `attack.ts:655-669` |
| Magiport | The mage magiports a teammate who is smart-moving far toward it, then calls `friend.acceptMagiport()` and `friend.stopSmartMove()` on the friend's object. | `strategies/magiport.ts:39-69` |
| Party heal | The priest checks the HP of all own characters on the same server (works across maps), then of nearby party members. | `strategies/partyheal.ts:46-81` |
| Boss finding | The move strategy checks its own sight, then every teammate's `getEntity`, then `bot.S`, then the Mongo DB. | `move.ts:591-712` |
| Merchant pickup | The merchant walks to a fighter and calls `friendBot.sendGold(...)` / `friendBot.sendItem(...)` **on the fighter's object**. | `merchant/strategy.ts:2503-2543` |
| Replenish | The merchant buys potions and sends them to fighters that cannot buy their own. Fighters can also pull items from teammates. | `merchant/strategy.ts:2185-2221`; `strategies/buy.ts:148-175` |
| Target choice | One planner function assigns setups to all characters together. | `earthiverse.ts:364-645` |
| Server choice | One hop function moves all characters together. | `earthiverse.ts:659-803` |

The **only cross-process / cross-server channel is MongoDB**: entities, players, NPCs and respawns that any of his clients (or his observers on every server) saw, read with `lastSeen` filters (section 5). In-game CM appears only for foreign bots (`PolioPartyStrategy`, `party.ts:64-95`; magiport service on request, `magiport.ts:80-133`).

Leadership: the first attacker in the config is the party leader (`earthiverse.ts:128`, `index.ts:418-421`). This leader has no special logic; the planner is the real "leader".

---

## 4. Merchant

### What it does
`startMerchant` (`merchant/strategy.ts:1423-1449`) applies avoid death, `NewMerchantStrategy`, tracker, party accept, a passive `BaseAttackStrategy` (zapper only), and `ToggleStandStrategy` (stand open when near its spot, closed while moving). The main entry adds sell/item/destroy/buy/statistics (`earthiverse.ts:955-981`).

`NewMerchantStrategy` has a single `move` loop (1 s) that runs **an ordered errand list**. Each step catches its own errors except banking (`merchant/strategy.ts:1517-1546`):

1. equip the best broom (`:1590-1598`)
2. join giveaways (`:2966`)
3. **banking** (`:1600-1660+`): when the inventory is nearly full, gold > `goldToHold`, or every 10 minutes. Deposit/withdraw gold to the target amount, destroy junk, keep held items, keep NPC-sellables, stack into existing bank stacks. A failed run backs off for 60 s. "Don't catch, we don't want to continue if banking fails."
4. holiday spirit / anniversary
5. deliver replenishables to fighters (`:2185-2221`)
6. deliver upgrades: better gear for fighters (`:2223+`, every 5 min)
7. collect gold and spare items from fighters (`:2503-2543`)
8. mluck travel (`:2640`), fishing (`:2391`), mining (`:2545`), craft (`:2154`), exchange (`:2375`)
9. **buy from player stands** found in the DB on this server (`:2726-2766`); **sell to buying stands** (`:2768+`); list own items for sale (`:3039`)
10. instance provider: open crypt/tomb instances with keys and record them (`:2020+`)
11. merit bonus, mini-boss check (`:3118`), trick or treat
12. finally smart-move back to the default position.

`mluck` has its own loop on the skill cooldown. Order: self, own team, others, and it never overrides another `earthMer` (`:1549-1584`).

Ponty: `BuyStrategy.buyFromPonty` runs when the merchant is near Ponty and refreshes Ponty's list at most every 30 s, only when the call cost is low (`bot.cc < 100`) (`strategies/buy.ts:106-125`).

The old `MerchantStrategy` class (`merchant/strategy.ts:243-1420`) is not used by any current entry point.

### Server hopping
There are three distinct mechanisms:

| Mechanism | Who | How | Where |
|---|---|---|---|
| Team hop for bosses | Whole team incl. merchant | Every 1 s, a target server is chosen: event bosses per event, then special monsters on other servers from the DB (`getServerHopMonsterPriority`: franky, crabxx, icegolem, goldenbat, cutebee; non-PVP first, lowest HP first), goobrawl keeps them, a manual override wins. The characters needing a hop lose their setups and open their chests first. Then `context.changeServer()` runs per character with **a 2 s stagger**, without waiting for slow retries. A `pendingHopContexts` set makes the planner skip them meanwhile. | `earthiverse.ts:657-803`; `base/serverhop.ts:151-220`; event variants `serverhop.ts:222-560` |
| Character set per server | Fighters | Instead of hopping characters, `index.ts` stops all bots and logs in a **different set of characters** configured per server (`SETUPS[region][id]`). The merchant is the same on both. This could be a way around hop sickness / realm fatigue **(unverified intent)**. | `earthiverse/index.ts:87-101`, `:331-426` |
| Deal-finder merchant | A second merchant (`earthMer2`) | **Ephemeral, per minute**: it checks which servers his merchants are already on, then picks a target from the DB in this order: a giveaway stand, a Ponty that sells wanted items, player stands with wanted items. It connects at the next minute + 10 s, runs the full merchant strategy, fetches Ponty items, and stops 10 s before the next minute. | `merchant/deal_finder.ts:11-55`, `:57-235` |

The general helpers are `getTargetServerFromDate` (round-robin server per minute with an offset per character) and `getTargetServerFromCurrentServer` (`serverhop.ts:12-58`). They are used by `tools/data_collector.ts` (peek characters that check spawns on rotating servers each minute, `data_collector.ts:63-140`). `strategy_pattern/runner.ts` has the same "ephemeral" connect/disconnect per minute as a runner option (`runner.ts:71-74`, `:294-335`). Why he aligns to minute boundaries is **unverified**.

Home server: `HomeServerStrategy` calls `setHome()` when the character is on the wanted server (`strategies/home_server.ts`).

---

## 5. Persistence

### MongoDB (optional; every DB feature checks `AL.Database.connection`)
The connection string comes from `credentials.json` (`mongo`). **ALClient writes most of the data by itself** whenever a character or observer sees something:

| Collection / model | Written by | Content | Read by the bots for |
|---|---|---|---|
| `EntityModel` | ALClient `Observer.ts:223`, `:410`, `:754`; bots `base/crypt.ts:11-36` | monsters with type, map, in, x/y, hp, target, conditions, `lastSeen`, server | boss search (`move.ts:627-688`), special monster priority (`base/monsters.ts:25-80`), server hop choice (`serverhop.ts:69-220`) |
| `PlayerModel` | `Observer.ts:152,177,756`; `Character.ts:424,737` | players incl. `slots` (so merchant stands with trade slots), owner, server, `lastSeen` | buy/sell at stands (`merchant/strategy.ts:2732`, `:2774`), giveaways, deal finder, item counts |
| `NPCModel` | `Observer.ts:755`; `Character.ts:3661,3982` | NPCs incl. Ponty items | deal finder (`deal_finder.ts:138-144`) |
| `RespawnModel` | `Observer.ts:412,519` | estimated respawn times | "everything is respawning, wait" (`move.ts:676-687`) |
| `InstanceModel` | `Observer.ts:489,879` | crypt/tomb instances | instance provider, cleanup (`crypt.ts:94-145`), `delete` admin command (`earthiverse.ts:296-310`) |
| `BankModel` | `Character.ts:314` | bank contents per owner | **total item counts** (bank + all characters' inventories and equipment, `itemsNew.ts:1507+`, cached 60 s) for upgrade/sell decisions |
| `DeathModel` | `Character.ts:521` | deaths | (reading not found in the current bot code) |
| `ServerModel`, achievements | `Observer.ts:419`; tracker | server info, achievement progress via `TrackerStrategy` every 15 min (`tracker.ts`) | — |

Stale data is cleaned up actively: if a teammate should be able to see a DB entity but doesn't, the DB row is deleted (`move.ts:654-665`). Finished instances are removed (`crypt.ts:94-145`).

Separately, `tools/data_collector.ts` runs one observer per server and **posts server statuses and NPC positions to aldata.info** (`data_collector.ts:17-60`). That is a public community database, not part of the bot state.

### Files
- `credentials.json`: login, and the refreshed auth written back by ALClient.
- `public.csv`: guest characters across a restart (`earthiverse.ts:343-356`, `:1325-1346`).
- `./<bot>_debug`: lines appended by `DebugStrategy.log` when `writeToFile` is set (`debug.ts:195-202`).
- `data/<bot>/<slot>`: every upgrade roll (`statistics.ts:7-31`).

### Memory only (lost on restart)
Contexts and current setups; toggles and overrides changed by command (`earthiverse.ts:95-98`, `:207-209`); chest cache per server (`base.ts:12`); looted-chest LRU; `AGGROED_MONSTERS` TTL cache (`attack.ts:97-100`); `checkOnlyEveryMS` timers (`base/general.ts:1-14`); the last 500 socket events per character (`debug.ts:53`, `:81-107`); Ponty cache (`buy.ts:111`); magiport cooldowns.

---

## 6. Watching and controlling

### Watching
- **Official observer view**: after a guest starts characters, the reply is "Go to https://adventure.land/comm to observer your character." (`earthiverse.ts:1397`). He relies on the game's own observer mode instead of rendering anything himself.
- **Console logs** (`console.log/debug/error` everywhere) and the optional per-character debug files (above). `DebugStrategy` keeps a ring buffer of the last 500 in/out socket events per character (`debug.ts:53-107`, `getEvents(id)`). Nothing in the current code exposes it over HTTP **(unverified that he reads it anywhere)**.
- `logLimitDCReport` prints the server's call report when a character is kicked for too many calls (`debug.ts:147-154`).
- **algui**: `GuiStrategy` starts the `algui` web server (a map view of the bots' sockets) and adds each bot (`strategies/gui.ts`). It is only used in `source/archive`, not in the current entry points.
- **Discord**: `tests/discord/*` is a slash-command bot for market and character lookups (data from aldata.earthiverse.ca, e.g. `commands/character.ts:16-41`). **No death/status alerts or webhooks were found** in the bot code.
- No stats dashboard (XP/h, gold/h) for his own team in this repo. The data lives in Mongo and in public aldata pages.

### Controlling: commands through the observer (`code_eval`)
This is the key finding for us. The game server lets an **observer socket send `o:command`**, which it relays to the observed character's own socket as **`code_eval`** (game server `node/server.js:5149-5159`). In the official client, the snippet editor's "command" action sends it (`js/functions.js:2365-2368`). The official MCP's code-eval tool uses the same path (`mcp_api.js:945-958`). A browser character would `eval` the text (`js/game.js:3278-3282`).

earthiverse's headless characters instead **parse the text as commands** (`bot.socket.on("code_eval", ...)`):

| Command | Effect | Where |
|---|---|---|
| `monster <a> <b> ...` / `monster` | Put these monsters at the front of the planner's priority list / clear | `earthiverse.ts:217-227` |
| `server <REGION> <ID>` / `server` | Force a server / clear | `:246-256` |
| `events on/off`, `monsterhunt on/off`, `serverhops on/off`, `specialmonsters on/off` | Feature toggles | `:228-245`, `:257-274` |
| `restart` | Save guests, exit the process | `:312-316` |
| `stop <name>...` | Stop guest characters | `:317-333` |
| `delete` | Delete the current instance from the DB | `:296-311` |
| `stop` / `disconnect` (on a guest character) | Stop that guest | `:1089-1111`; `public/runner.ts:127-141` (exits the whole runner) |

There is **no "take over this character" mode**. The way to drive a character by hand is to steer it with these commands, or stop the context **(unverified whether he does anything else)**.

### Public "Character Launcher" (`source/public/*`)
- `index.html` is a form: user ID, auth code, up to 4 characters (the first is the party leader), region, server, farm monster, use bank_b / bank_u, do events (`index.html:320-443`).
- `server.ts` (Express, port 80 or `PORT`) validates the input and spawns a separate `runner.js` process with the config as base64 (`server.ts:36-113`). The process ID is returned; there is no stop button. Stopping is done in game with the `stop` command.
- `runner.ts` runs the characters with generic setups for the chosen monster and event setups (goobrawl etc.), with self-healing connect loops (`runner.ts:373-434`).
- The older variant in `earthiverse.ts:1120-1323` + `:1364-1407` ran guests **inside his main process**, joined his party, used `MAX_PUBLIC_CHARACTERS = 6` and validated input with express-validator.

---

## 7. Error handling and safety

| Topic | What he does | Where |
|---|---|---|
| Loop errors | Every loop run is in try/catch; the loop goes on. Most actions end with `.catch(console.error)` or `.catch(suppress_errors)`. | `context.ts:111-119`; `logging.ts:30-32` |
| Planner errors | try/catch/finally with `setTimeout(..., 1000)` → the planner never stops | `earthiverse.ts:798-802`, `:874-878` |
| Death avoidance | Every 100 ms: predict burn damage → `harakiri` if it would kill anyway; sum the max damage of monsters targeting us (+20 % per extra attacker beyond courage) → `warpToJail` (or `harakiri` when stunned/frozen). On every `action` aimed at us: mage blinks away from `multi_burn`; if projectiles could kill → jail. | `strategies/avoid_death.ts:4-89` |
| Courage | Attacks skip a new target if it would exceed courage / mcourage / pcourage | `attack.ts:334-353` |
| Respawn | Every 1 s `respawn()` when dead; the merchant respawns in its move loop | `respawn.ts`; `merchant/strategy.ts:1519` |
| Disconnects | Automatic reconnect with error-specific delays, fatal on `nouser`, superseded attempts are cancelled, never two sockets | `context.ts:169-173`, `:233-241`, `:350-412` |
| Already online | `ingame` → retry after 0.5 s; public runner waits 10 s if `online` | `context.ts:238`; `public/runner.ts:388-391` |
| Rate limits | Optional calls only when the call cost is low (`bot.cc < 100`): Ponty refresh, tracker, entity re-request | `buy.ts:114`, `tracker.ts:30-34`, `fixes.ts:19` |
| Login spread | 2.5 s between characters (public runner), 2 s stagger in team hops | `public/runner.ts:479-480`; `earthiverse.ts:780-791` |
| Server-sent kick reasons | `limits` → 40 s; `wait_N_second` honoured | `context.ts:235-237` |
| Banking failure | The merchant stops its errand list and backs off 60 s | `merchant/strategy.ts:1524`, `:1600-1622` |
| Backup characters | Event scripts start a backup merchant/priest if the main one failed to start | `christmas/christmas.ts:690-708` (same in halloween, valentines) |
| Stuck detection | **None found**: no heartbeat, no watchdog, no "position unchanged for N minutes" check. Smart moves have `stopIfTrue` callbacks so boss chasing re-plans (`move.ts:715-724`). | — |
| Bad config | `runSanityCheckOnItemConfig` checks item configs (also guest configs) before use | `itemsNew.ts:1311`; `earthiverse.ts:1129-1131` |
| Party allow list | Only listed names can join the party | `party.ts:24-25` |

---

## 8. Ideas worth copying, and what would not fit

### Worth copying
1. **One process, all characters directly reachable.** It confirms our E2 (a). He gets cheap, synchronous teamwork from it: overkill prevention, energize, chest choice, merchant pickup, magiport accept. Our vm contexts could get the same benefit through a small synchronous, read-only **team view** from the supervisor (HP/MP, position, map, target, inventory summary, `smart.moving`). A few **cross-character requests** (accept magiport, send gold or items to the merchant, stop smart move) could run as supervisor calls instead of CM round trips. Our existing `get`/`set` + CM protocol can stay as the fallback, so the browser keeps working.
2. **Reconnect logic of `Strategist`** (`context.ts:233-412`): an attempt counter that cancels superseded attempts, never two sockets per character, error-specific delays (`wait_N_second`, `limits`, `ingame`, fatal `nouser`). After a reconnect, re-attach listeners by re-running each module's "apply" step. This maps 1:1 onto our planned `connection.js` + supervisor.
3. **`code_eval` as a command channel.** If our headless runtime listens to `code_eval`, the player can type commands from the Steam client's observer view (snippet "command"), and the official MCP code-eval path should also reach it **(unverified for MCP; the server relay itself is confirmed)**. That is control without our web app. It can call our existing `handle_command`. Prefer a small **command parser** (like his `monster`, `server`, `pause`, `restart`) over raw `eval`.
4. **Named loops with cooldown-based intervals** for the parts that must not wait for each other: heal/potions, avoid death (100 ms), party heal, attack on skill cooldown. We could keep the fighter tick for decisions and move "always-on" safety into its own fast loop. This matters more headless, where a slow pathfinder call would otherwise block potions.
5. **Ranked setups per monster** (`setups/phoenix.ts:77-100`): a list of team compositions from best to worst, each with class requirements (level, items) and per-class options (loadout attributes, aggro flags). This is a good template for our `encounters/` per-monster files.
6. **Hop procedure** (`earthiverse.ts:755-797`): mark as "hopping" so the planner leaves the characters alone, remove their activity, **open chests first**, hop with a stagger, keep per-server chest caches.
7. **Ephemeral merchant per minute** (`deal_finder.ts`): connect, do one round, disconnect before the next minute, and avoid servers where our own merchant already is. This is a clean pattern for our Ponty round. It has to be checked against hop sickness (merchants ≥ 60) and our own `servers_and_characters` guard.
8. **Death avoidance by prediction** (`avoid_death.ts`): sum the incoming max damage incl. the mobbing multiplier, check burn ticks, and react on `action` events, not just on a timer. Compare with our `safety/` modules.
9. **Item counts across bank + all characters** (`itemsNew.ts:1507`) as input for upgrade/sell decisions. For us that is the shared storage (bank snapshot + each character's inventory), no Mongo needed.
10. **Low-priority calls only when the call budget is low** (`cc < 100`). We planned a call budget in `connection.js`; his gate is a simple version.
11. **The server's limit-disconnect report** (`limitdcreport`) logged per character; and a ring buffer of the last N socket events per character, to show in our web app after a disconnect.

### Would not fit (or not now)
| Idea | Why not for us |
|---|---|
| ALClient + its Rust/WASM pathfinder | Already decided: own client, own JS pathfinder (PLAN.md "Already decided"). His code shows which calls a team bot needs, not code we import. |
| MongoDB as the shared world database | Too heavy for a Pi and not needed for one team on one server. Our shared storage on disk + SQLite (PLAN.md 2.4) covers it. His DB is valuable mainly because it is fed by **observers on every server** (`data_collector.ts`); that is a different goal (multi-server boss hunting). |
| Team-wide boss hopping across all servers | Realm fatigue (a fighter gets a condition if another fighter of the account was on a different server in the last 30 min) and hop sickness for level ≥ 60. Our party stays on EU II; only the merchant hops. |
| Character sets per server (`index.ts`) | Needs many characters of each class; we have 3 fighters + 1 merchant. |
| Public launcher / guest characters | Running other people's auth codes is a different product and a security risk. |
| Strategies that drive other characters' objects freely | Fine in his single-author TypeScript code. In our vm contexts it would break the "each character's CODE is self-contained" model and the browser fallback. Use explicit supervisor calls instead (idea 1). |
| Replacing our tick with ~25 independent timer loops | A big rewrite of `bot/` against our plan "only small changes to bot/". Take only the safety loop (idea 4). |
| No watchdog | He has none. We should keep our heartbeat watchdog (PLAN.md 2.4); his reconnect only covers socket drops, not a bot that is stuck while connected. |
| Discord bot | His is a market lookup tool, not monitoring. Not needed. |

---

## Lessons for us

1. **One process is the proven layout** for a headless team. The big gain is synchronous access to teammates. Plan a read-only team view + a few supervisor calls for our vm contexts, and keep CM/`get`/`set` working for the browser.
2. **Copy the reconnect state machine** from `Strategist` (attempt counter, single socket, delays by error text, re-apply listeners). Add our own watchdog on top, because he has no stuck detection.
3. **Listen to `code_eval`** on every headless character and route it to `handle_command`. Then the Steam client's observer view becomes a remote control at no cost. This fits the "watch in the official client" plan in PLAN.md 2.4. It should be the first control path, before the web app.
4. **Separate safety from the tick**: a fast, independent loop for potions, avoid death and respawn, so pathfinding or banking never delays them.
5. **Per-monster encounter files with ranked team compositions and requirements** are a good shape for `encounters/`. His `setups/*.ts` are a large reference library of per-boss tactics (loadouts, aggro flags, kiting) worth reading when we add a boss.
6. **Merchant hop = short, timed visits**: connect, do the round, disconnect, and avoid servers where we are already present. Open chests and finish trades before leaving.
7. **Keep persistence small**: he needs Mongo for cross-server observation. For us the shared storage file + SQLite stats are enough. Things he keeps only in memory (overrides, chest caches) are what a restart loses; we should persist overrides.
8. **Observability is his weak spot**: console logs, debug files, no dashboard, no alerts. Our planned web app (journal, XP/gold per hour, boss timers) plus a per-character ring buffer of recent socket events and the `limitdcreport` would already be ahead of what he has.
