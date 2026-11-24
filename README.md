# Adventure Land Bot (v1)

One bot for a whole Adventure Land team: up to three fighters and one merchant, all running the same code.
The fighters farm, hunt bosses and level up; the merchant supplies them, sells, banks, trades with other players and upgrades their gear.

> **Version:** `1.236.1` (`bot/config.js` → `version`) · **Teams:** `Dmpx…` (main account) and `Viz…` (second account) · **Code:** `bot/` → in-game CODE slots 20–41

## Repository

| Folder | Content |
|---|---|
| [`bot/`](bot/) | The bot: `main.js`, `config.js`, `core/` (fighter, targeting, party, events, hunts, drops, gear, supply), `classes/`, `roles/` (merchant, workshop), `lib/` (util, comms) |
| [`scripts/`](scripts/) | `deploy-bot.mjs` (uploads the bot into its CODE slots), gear catalog and gear plan generators |
| [`docs/gear-guide/`](docs/gear-guide/) | Gear plan and gear progression guide (HTML/PDF) with the source charts |
| [`docs/gear-catalog/`](docs/gear-catalog/) | Item data for the gear catalog |
| [`docs/snapshots/`](docs/snapshots/) | Account snapshots (levels, gear, gold) and stats pictures over time |
| [`docs/research/`](docs/research/) | Comparisons with other bots |
| [`docs/headless/`](docs/headless/) | Plan for an own headless client |

File paths in this README are relative to `bot/` unless they start with another folder.

---

## Contents

**Control: what you need day to day**
1. [Chat commands](#1-chat-commands)
2. [Start, stop, reload, deploy](#2-start-stop-reload-deploy)
3. [Config switches you will use](#3-config-switches-you-will-use)
4. [Storage keys worth knowing](#4-storage-keys-worth-knowing)
5. [Reading the logs](#5-reading-the-logs)

**How the bot behaves**

6. [Architecture](#6-architecture)
7. [Team, phases and roles](#7-team-phases-and-roles)
8. [Fighter: the main loop](#8-fighter-the-main-loop)
9. [Potions, resting and survival](#9-potions-resting-and-survival)
10. [Choosing where to farm](#10-choosing-where-to-farm)
11. [Safety checks](#11-safety-checks)
12. [Crowded, taken and too-strong spots](#12-crowded-taken-and-too-strong-spots)
13. [Picking the next monster](#13-picking-the-next-monster)
14. [Kiting and spacing](#14-kiting-and-spacing)
15. [Cavalry (Tracktrix)](#15-cavalry-tracktrix)
16. [Party play](#16-party-play)
17. [Events and world bosses](#17-events-and-world-bosses)
18. [Monster Hunts](#18-monster-hunts)
19. [Drop farming](#19-drop-farming)
20. [Fighter gear: wishes and equipping](#20-fighter-gear-wishes-and-equipping)
21. [Supply: loot, gold and potions](#21-supply-loot-gold-and-potions)
22. [Death handling](#22-death-handling)
23. [Classes and skills](#23-classes-and-skills)
24. [Merchant: the main loop](#24-merchant-the-main-loop)
25. [Selling and banking](#25-selling-and-banking)
26. [Market stand and player trades](#26-market-stand-and-player-trades)
27. [Ponty rounds over all servers](#27-ponty-rounds-over-all-servers)
28. [Workshop: wishes and upgrades](#28-workshop-wishes-and-upgrades)
29. [Workshop: gear goals and stages](#29-workshop-gear-goals-and-stages)
30. [Workshop: weapons and material goals](#30-workshop-weapons-and-material-goals)
31. [Workshop: compounding, exchanges, dismantling](#31-workshop-compounding-exchanges-dismantling)
32. [Money: pots, budgets and prices](#32-money-pots-budgets-and-prices)
33. [Watchdog and server hops](#33-watchdog-and-server-hops)
34. [Rules the bot never breaks](#34-rules-the-bot-never-breaks)
35. [Inactive or surprising settings](#35-inactive-or-surprising-settings)

---

# Control

## 1. Chat commands

Type these in the chat box of a game client that runs the bot. The game passes unknown commands to the bot's `handle_command` (`main.js`).

| Command | Where | What it does |
|---|---|---|
| `/pickup` | any fighter | Ask the merchant to come now (potions, loot handover). |
| `/ponty` or `/ponti` | any of our clients | The merchant starts a Ponty round on its next check (shared storage `bot_ponty_force`, dropped after 10 min). Started in minutes 0–29 of an hour, it counts as that hour's round. |
| `/phoenix` | leader | Search the Phoenix now and lift its 3 h pause. |
| `/jr`, `/greenjr`, `/mvampire`, `/fvampire`, `/skeletor` | leader | The same for Jr., Green Jr., Dracul, Ms. Dracul and Skeletor. In the party phase a runner searches them; in solo it only lifts the pause. |
| `/search <boss>` | leader | The same for any watched boss (default `phoenix`, e.g. `/search fvampire` for Ms. Dracul). Aliases: `phönix`, `phonix` → phoenix · `vampire`, `vampir`, `dracul` → mvampire · `msdracul`, `missdracul` → fvampire · `gjr` → greenjr. |
| `/agitate off\|swords\|splash\|chain\|splashstream\|config` | warrior | The warrior's Agitate mode, kept across restarts (`agitate_mode:<name>`). `config` goes back to the config's choice. Solo only: in a party the automatic decision applies. |
| `/dps` | leader or solo fighter | Print the damage meter now ([§16](#16-party-play)). |
| `/kills` | leader or solo fighter | Kills by target at death over the last 10 min, with the average luck the game rolled them with (v1.217.1, for the luck catch). Logged on its own every 10 min (`kills` tag, also in the journal). |
| `/safety [map]` | leader | Log every member's guide verdict and the team model's verdict for every monster on the map. |

Boss commands answer in chat with `[bot] …` (for example `only the leader (X) searches`).

## 2. Start, stop, reload, deploy

### Starting

1. Open the **leader** in the game client. The leader is `team.leader`, or `otherTeams[].leader` for the second account. In solo it is the solo fighter.
2. Load CODE slot **20 `bot_main`** and press **Run**.
3. The leader starts everyone of the current phase as CODE-only characters in the same client:
   - `solo`: only the merchant;
   - `party`: the other party fighters and the merchant.

A fighter listed in `team.solo` farms on its own outside the party and starts the merchant itself.

### Stopping

- **Stop** on the leader stops only the leader. CODE-only characters keep running until they are stopped too.
- While the [watchdog](#33-watchdog-and-server-hops) is on, a member that stops beating is restarted. Stop the leader first, or switch `watchdog.enabled` off.

### Deploying new code

The repo is the source of truth. `scripts/deploy-bot.mjs` uploads changed files into their slots through the Adventure Land JSON API.

```powershell
# main account (token from ADVENTURELAND_TOKEN)
node scripts/deploy-bot.mjs
# second account (token from ADVENTURELAND_TOKEN_VIZ)
node scripts/deploy-bot.mjs --account viz
```

| Flag | Effect |
|---|---|
| *(none)* | Upload the files that differ from their slot. |
| `--dry-run` | Only show what would change. |
| `--pull` | Copy slots that were edited in game into the repo. |
| `--force` | Upload even over in-game edits. |
| `--account <name>` | Another account; token from `ADVENTURELAND_TOKEN_<NAME>`. |

`scripts/.deploy-state*.json` remembers what was last deployed. A slot edited in game since then is not overwritten: run `--pull` first, or `--force`.

### Uploading is not running

Saving a slot does not change running code. Reload each character:

1. **Members first** (in party: the other fighters), then about 10 s later **the leader**. Reloading the leader does **not** reload running members.
2. **The merchant** only when it is idle: no trade trip, no Ponty round, empty upgrade queue. Check that `get("bot_trade_trip:<merchant>")` and `get("bot_ponty_round:<merchant>")` are `null` and `character.q` is empty.

## 3. Config switches you will use

All settings live in [`config.js`](bot/config.js) (slot 21 `bot_config`). The comments there explain every value and the decision behind it. These are the ones you change most often.

### Solo or party

| Goal | Change |
|---|---|
| **Warrior solo** (Lone Wolf) | `otherTeams[0].leader: "VizWar"`, `phase: "solo"`, `hunts.enabled: false` |
| **Back to the party** | `otherTeams[0].leader: "VizPri"`, `phase: "party"`, `hunts.enabled: true` |
| A fighter farms on its own outside the party | add it to `team.solo` |
| Second account's team | `otherTeams` entry: `{ name, leader, fighters, solo, merchant, farm }`. The team that lists the running character is used. |

### Where to farm

| Goal | Change |
|---|---|
| Force a farm target for the whole team | `targeting.farm: "cgoo"` or a list `["mummy", "booboo"]` (the first one not blocked). `null` = the bot decides. |
| Force a target for one character | `team.farm: { VizRng: "bee" }` |
| Fallback when the progression guide has no answer | `targeting.fallback: "goo"` |
| Rare monsters attacked first | `targeting.rare.types` |
| Take a crowded or shared spot sooner or later | `targeting.crowdedAfterMs`, `crowdedForMs`, `occupiedForMs`, `stayIfBusy` |
| Waypoints for dangerous routes | `travel.via: { spookytown: "halloween" }` (there), `travel.leaveVia: { spookytown: "halloween" }` (back) |

### Bosses and events

| Goal | Change |
|---|---|
| Join or skip an event or boss | `events.policy.<name>: "always" \| "never"` |
| Minimum team level per event | `events.minLevel` |
| How often the Phoenix is searched | `events.searchEveryMs` (20 min) |
| Bosses the team searches / only fights when met | `events.search` / `events.engage` |
| Parallel search in the party | `events.splitSearch` |
| Runner for Dracul, Ms. Dracul, Jr., Green Jr., Skeletor | `events.runner.enabled`, `runner.bosses` (interval per boss) |
| Hunt a boss nonstop with the runner | `events.farmBosses: ["phoenix"]` |
| Pause after a death at a boss | `events.boss.pauseAfterDeathMs` (3 h); lift it with `/phoenix` etc. |

### Combat

| Goal | Change |
|---|---|
| HP potion thresholds | `combat.potionHpBelow` (0.8), `hpCriticalBelow` (0.3), `hpWhenFits` (true) |
| MP potion thresholds | `combat.potionMpBelow` (0.5), `mpFirstAboveHp` (0.65), `mpTopUp` (0.5) |
| Resting after a fight (solo) | `combat.recover` |
| Kiting | `combat.kite.enabled` |
| Warrior Dash | `classes.warrior.dash.enabled` (now `false`) |
| Warrior Agitate | `classes.warrior.agitate.enabled`, `.monsters` (`"auto"`), or `/agitate` in chat |
| Warrior sword swap | `classes.warrior.swordSwap.enabled` |
| Priest heal thresholds | `classes.priest.healBelow`, `partyHealBelow`, `partyHealOne` |

### Merchant, market and money

| Goal | Change |
|---|---|
| Stand buy orders | `market.buy: [{ item, price, want }]` |
| Stand sell orders | `market.sell: [{ item, price, keep, max }]` |
| Sell into other players' buy orders | `market.sellTo.items: [{ item, level, minPrice, keep }]` |
| Buy from other players' stands | `market.sellTo.buyFromPlayers` |
| Ponty buying rules | `market.ponty` (`maxShareOfOwn` 1.2, `maxShareOfPot` 0.2) |
| Ponty rounds over all servers | `merchantRole.pontyRound.enabled`, `everyHours` (3) |
| What the merchant sells to NPCs | `merchantRole.sellList`, `merchantRole.sellBuyable` |
| What stays in the bag at the bank | `merchantRole.bank.keep` |
| Share of income for gear | `workshop.gearGoals.budget.incomeShare` (0.7) |
| One-off extra gold for a pot | `gearGoals.budget.extra: { amount, until }`, `bruteForce.extra` |
| Fresh start of every pot | `gearGoals.budget.resetAt: "<ISO time>"` |
| Never spend below | `workshop.keepGold`, `merchantRole.goldReserve` |

### Gear and weapons

| Goal | Change |
|---|---|
| Weapon list per class (worst → best) | `gearPlan.weapons` |
| Highest level for list weapons | `gearPlan.weaponCaps` (`default: 7`) |
| Essence and Bones goals | `materialGoals.materials.<material>` (`upTo`, `deliver`, `budget`, `buyCopies`, `sources`) |
| Items turned into material | `dismantle.names` |
| Gear wish chains (rings, belts, Rugged, Wanderer's …) | `gearPlan.wishes` |
| Shop gear stages | `workshop.gearGoals.stages` (`[7, 8]`) |
| Never equip | `gear.noEquip` |
| Ponty base buying | `workshop.baseTargetPieces` (1), `maxBaseCopies` (20) |

### General

| Goal | Change |
|---|---|
| Restart silent members | `watchdog` |
| Hide gold and kill lines in the game log | `ui.hideGoldLogs`, `ui.hideKillLogs` |
| Use the Town teleport on long routes | `movement.useTown`, `townMinDistance` |

## 4. Storage keys worth knowing

The bot keeps state in the game's `get()` / `set()` storage, which all our windows share. Read a key with `get("key")` in a client console or a CODE snippet. Clear it with `set("key", null)`.

A running bot keeps most of these in memory and writes them back on every change. Clear a key and then **reload** that character, or use the chat command where one exists.

**Names** (v1.233.0, player decision 2026-11-24): the bot's own names carry no account name - storage keys `bot_…`, page variables `__bot…`, message protocol `bot1`. Until v1.232 they started with the first account's prefix; the first start of v1.233.0 moves the old stored keys to `bot_` (a key that already exists under the new name wins), takes the old socket listeners off and undoes the old `cave_request` wrapper (`main.js`, `migrateFromOldPrefix`). Character names in logs and the status box lose their team prefix (`util.shortName`: the fighters' common start, e.g. "Viz").

| Key | Holds | Clearing it… |
|---|---|---|
| `bot_ponty_round:<merchant>` | Running Ponty round | aborts a stuck round |
| `workshop_blocks:<merchant>` | Workshop jobs paused after a stop (until time) | retries every paused job at once |
| `bot_trade_trip:<merchant>` | Running trade trip | aborts a stuck trip |
| `bot_ponty_force` | `/ponty` request | cancels the request |
| `bot_hop_request:<merchant>` | Server hop request | — |
| `bot_boss_pause:<leader>` | Boss pauses after deaths | lifts them (better: `/phoenix` …) |
| `bot_boss_search:<leader>` | Next search time per boss | makes every boss due |
| `bot_farm_experience:<name>` | Proven spots, 1 h death blocks | removes death blocks |
| `bot_crowded:<name>` | Crowded spots and their doubling | frees crowded spots |
| `bot_strong_spots:<name>` | Spots waiting for the Cavalry | — |
| `bot_cavalry_next` | Next Cavalry call (account-wide) | — |
| `agitate_mode:<warrior>` | `/agitate` override | back to config |
| `agitate_stats:<warrior>` | Learned splash, scale and denies per monster | relearns from scratch |
| `workshop_earmarks:<merchant>` | Copies reserved for fighters | releases them |
| `workshop_delivered:<merchant>` | Delivered wishes (6 h pause) | allows redelivery now |
| `workshop_worn:<merchant>` | What each fighter wears | refilled on the next wishes |
| `workshop_wishes:<merchant>` | Each fighter's wish list | refilled every 5 min |
| `workshop_income:<merchant>` | 24 h income and spending (all pots) | **resets every pot** |
| `bot_beat:<name>` | Heartbeat `{at, server, hp, rip}` | — |
| `bot_journal:<name>` | Last 400 decision lines with timestamps | — |
| `bot_ponty_bought` | Last 200 purchases (Ponty, orders, players) | — |
| `bot_ponty_round_log` | Last 50 Ponty rounds | — |
| `bot_trade_log` | Last 100 player trades | — |
| `bot_value_report` | Last value report | — |

## 5. Reading the logs

Every bot line starts with a tag: `[tag] text`. The status box above the character shows the current action (for example `searching cgoo`, `rest 62%`, `kiting phoenix`, `working on wcap +6`).

| Tag | Who | About |
|---|---|---|
| `bot` | all | start, version, watchdog, hops |
| `target` | fighters | farm target and why (`farm target: X (guide, team model)`) |
| `combat` | fighters | potions, resting, heal-up, danger |
| `safety` | fighters | skipped monsters, unsafe spots |
| `event` | fighters | live events, boss searches, kills, pauses |
| `hunt` | fighters | Monster Hunts and Daisy trips |
| `drops` | leader | drop farming and spot values |
| `gear` | fighters | wishes, equipping |
| `cavalry` | fighters | Cavalry calls and resets |
| `party` | fighters | invites, waiting, chest opener |
| `dps` | leader / solo | damage meter every 5 min |
| `death` | fighters | what killed us (last 10 s of hits, potions) |
| `warrior`, `priest`, `rogue`, `paladin` | that class | skill decisions (Agitate pulls, sword swap, Dark Blessing, Smoke …) |
| `move`, `loot`, `comms` | fighters | failed routes, chest diagnosis, failed messages |
| `supply` | fighters | handovers, self-buying |
| `merchant` | merchant | pickups, selling, banking, trips, rounds |
| `workshop` | merchant | upgrades, deliveries, budgets, purchases |
| `value` | merchant | value report (gain per hour per wish) |

The lines tagged `target`, `drops`, `hunt`, `event`, `party`, `cavalry` and `dps` also go into the **decision journal** (`bot_journal:<name>`, last 400 lines).

The merchant logs a **workshop report** every 10 min, for example:

```
budget: goals Xk, ladder Yk, shopping 0k (24h: in G - fighters F, sales/other S; consumables C; gear spent P)
| working on: wcap+7 VizRng | essenceoffire goals: fireblade+7 p1 VizWar (U used) | mbones goals: …
```

---

# How the bot behaves

## 6. Architecture

`main.js` runs on every character. It loads the config, finds the character's role and team, and loads the modules for that role:

- **fighter:** party, hunts, events, drops, class module, targeting, gear, supply, then the fighter loop;
- **merchant:** workshop, then the merchant loop.

Only `main.js` calls `require_code()`. Every other module is a factory that receives a shared context (`ctx`), so nothing is evaluated twice.

| File | Slot | Purpose |
|---|---|---|
| [`main.js`](bot/main.js) | 20 `bot_main` | Entry point, role lookup, starts the team, chat commands, watchdog, hop watcher |
| [`config.js`](bot/config.js) | 21 `bot_config` | Everything you tune |
| [`lib/util.js`](bot/lib/util.js) | 22 `bot_util` | Shared helpers: damage formula and defense against a damage type (`defenseVs`, `hitMultiplier`), fear, mobbing, learned hit factors, attackers on us, healer test, spawn boxes, weapon power, kite risk, logging, heartbeat, team derivation |
| [`lib/comms.js`](bot/lib/comms.js) | 23 `bot_comms` | CODE messages between our own characters |
| [`core/targeting.js`](bot/core/targeting.js) | 24 `bot_targeting` | Farm spot, safety checks, target picking |
| [`core/supply.js`](bot/core/supply.js) | 25 `bot_supply` | Fighter side of loot, gold and potions |
| [`core/fighter.js`](bot/core/fighter.js) | 26 `bot_fighter` | Fighter main loop: potions, combat, kiting, travel, Cavalry, deaths |
| [`classes/paladin.js`](bot/classes/paladin.js) | 27 `bot_class_paladin` | Paladin skills |
| [`classes/mage.js`](bot/classes/mage.js) | 28 `bot_class_mage` | Mage skills |
| [`classes/priest.js`](bot/classes/priest.js) | 29 `bot_class_priest` | Priest heals and skills |
| [`roles/merchant.js`](bot/roles/merchant.js) | 30 `bot_merchant` | Merchant main loop, selling, banking, stand, trips, Ponty rounds |
| [`core/party.js`](bot/core/party.js) | 31 `bot_party` | Invites, leader broadcast, following |
| [`core/hunts.js`](bot/core/hunts.js) | 32 `bot_hunts` | Monster Hunts and Daisy trips |
| [`core/gear.js`](bot/core/gear.js) | 33 `bot_gear` | Fighter wishes and equipping |
| [`roles/workshop.js`](bot/roles/workshop.js) | 34 `bot_workshop` | Merchant: upgrades, gear goals, weapons, materials, pots, Ponty |
| [`core/events.js`](bot/core/events.js) | 35 `bot_events` | Events and world bosses |
| [`classes/ranger.js`](bot/classes/ranger.js) | 36 `bot_class_ranger` | Ranger skills |
| [`core/drops.js`](bot/core/drops.js) | 37 `bot_drops` | Drop farming and spot gold |
| [`classes/warrior.js`](bot/classes/warrior.js) | 38 `bot_class_warrior` | Warrior skills, Agitate, sword swap |
| [`classes/rogue.js`](bot/classes/rogue.js) | 39 `bot_class_rogue` | Rogue skills |

[`slots.json`](bot/slots.json) holds the same file-to-slot mapping for the deploy script.

**Messages between characters** (`comms.js`): `send_cm` with the envelope `{ p: "bot1", t: type, d: payload }`. A message is accepted only from a character of our own team (`config.characters`) and only for a known type. Other players' messages are ignored.

## 7. Team, phases and roles

- **Team.** `util.deriveTeam` picks the team block that lists the running character: `team` (main account) or an `otherTeams` entry (for example `viz`). It fills in `config.leader`, `config.merchant`, `config.characters` and `config.phases`.
- **Phase.** `config.phase` decides who runs:
  - `solo`: only the leader fights (Lone Wolf bonus). The leader starts the merchant. There is no party: no following, no spacing, no team wait, no runners. Resting and heal-up before a costly fight are on.
  - `party`: the leader invites the other fighters (except `team.solo`), starts them and the merchant, and leads.
- **Roles.**
  - The **leader** picks the farm spot and searches bosses.
  - **Members** follow, assist and heal.
  - The **merchant** supplies everyone.
- **Limits.** At most three fighters may be online. The archive characters of the main account are never listed in a team: the bot would hand their items to the merchant.

## 8. Fighter: the main loop

The fighter loop runs every `tickMs` (250 ms). Each pass writes the heartbeat `bot_beat:<name>`. Order of one tick:

1. **Death:** while dead nothing else runs ([§22](#22-death-handling)).
2. **Damage meter** (leader or solo): see [§16](#16-party-play).
3. **Survival:** the class's `survive()` (for example the priest's self-heal), otherwise the potion logic ([§9](#9-potions-resting-and-survival)).
4. Class `always()` (for example the warrior's Charge and sword swap).
5. **Chests** ([§16](#16-party-play)).
6. **Party:** invites, leader broadcast.
7. **Gear pass** ([§20](#20-fighter-gear-wishes-and-equipping)).
8. **Cavalry** ([§15](#15-cavalry-tracktrix)). While walking to a pack for a reset, the tick ends here.
9. **Busy steps**, in this order: leader waits for the team → handover to the merchant → event or boss search → Monster Hunt trip → members keep up with the leader → members follow a travelling leader.
   - While busy, the fighter only **defends in place**: it attacks monsters that already attack us or a member and are already in range, and never takes a step.
10. **Kiting** away from the current attacker ([§14](#14-kiting-and-spacing)).
11. **To the healer** (a member below `party.toHealerBelow` 50 % walks into the priest's range) and **cover** (a priest leader moves towards a member under attack).
12. The class's `support()` (heals, Taunt, Agitate …).
13. **Combat:** pick the farm spot and the target, walk or attack ([§10](#10-choosing-where-to-farm)–[§13](#13-picking-the-next-monster)).

**Strike loop.** A separate loop fires the attack, heal or multi-target skill the moment the attack cooldown ends, with ping compensation (`min(150, ping × 0.9)` ms). Targets already doomed by attacks in flight are not hit again.

**Travel.** Routes use `smart_move`.
- `travel.via` sends a route to `spookytown` through `halloween` first, avoiding the Vampire Rats.
- `travel.leaveVia` (v1.215.0) does the same on the way out: every path walk leaving `spookytown` for another map (travel, following the leader, pickups, bank and potion walks) goes to `halloween` first. Before, the way back went spookytown -> level2 -> level1 past the level-20 Vampire Rats. A direct neighbour (`level2`) and goals whose map can't be told are walked to as asked. The leg to `halloween` itself could still run through level2 and level1 (the halloween door is far from Jr.'s corner), so since v1.219.5 the Vampire Rats are walls for every path walk: `travel.wallMonsters: ["prat"]` turns the spawn boxes of packs without a rage box into rage zones.
- A failed route marks its point bad for 60 s; the bot then walks by monster name.
- The Town teleport (`movement.useTown`) is used only farther than 600 px from the map's center, never while monsters attack us, and never while following a leader.
- **Pass-through:** the leader or a solo fighter on its way to the farm spot leaves slower attackers of other kinds behind (HP ≥ 50 %, not within 400 px of the spot, never bosses). Any fighter stuck for 60 s fighting a non-farm kind walks out towards the farm target (`combat.passThrough`). Members pass through as well once the leader is gone (another map, or beyond `party.farmRadius`), and while passing through there are no kite steps (v1.217.7: the kite step cut the walk every time the monster came near - a step, a wait, a step). **No-chase kinds** (v1.219.6, player decision): on the way only the farm kind is fought back. Other kinds without `rage` are passed by every fighter - members too, leader present or not, at any HP and speed - as long as they are the only ones on us or ours and we are not within 400 px of the spot. Server rule (`node/server.js`): without rage a monster hits a passer-by in front of it but never takes up the chase; only our own hit, a taunt or Agitate makes it follow, and with rage 0 it gives up 20 s after our last hit. Hitting a Fire Spirit back is what keeps it on us.

## 9. Potions, resting and survival

HP and MP potions share one cooldown. Potion size is `"auto"`: `hpot1`/`mpot1` once max HP reaches 1500 / max MP 1000 (`potions.bigFrom`), small ones before.

**Decision order** (first match wins):

0. **Danger brake:** an HP potion when the predicted next hits of every attacker on us reach our HP. This even fires next to a healer.
1. **Town teleport channel:** no potion above 30 % HP (a potion would cancel the teleport).
2. HP below `hpCriticalBelow` (30 %): HP potion.
3. **`hpWhenFits: true`** (solo, without a healer): an HP potion whenever a whole one fits, unless MP is nearly empty (below 3 attacks' worth).
4. MP potion when MP is nearly empty, or when MP is below `potionMpBelow` (50 %) or a whole MP potion fits, and HP is above `mpFirstAboveHp` (65 %). With `hpWhenFits` on, MP takes the gaps between HP potions.
5. HP below `potionHpBelow` (80 % solo, 60 % with a healer): HP potion.
6. MP below `potionMpBelow`: MP potion.
7. `potionWhenMissing`: HP potion once a whole one fits.
8. `mpTopUp`: MP potion once half an MP potion is missing.

**With a healer** (a living priest within 600 px, or we are the priest), `combat.withHealer` overrides only `potionHpBelow` (60 %) and `potionWhenMissing` (off): HP potions only below 60 % (step 5) or 30 % (step 2), and no HP top-ups (steps 3 and 7 are off). The MP rules stay: step 4 still gives MP first (with `hpWhenFits` on, at any HP above 30 %), and `mpTopUp` still tops MP up. Exception: losing ≥ 6 % of max HP per second over ~3 s brings back the solo rules.

**Resting** (solo only, `combat.recover`):
- Starts after a fight below 50 % HP or MP. While resting, the fighter pulls nothing new and drinks up to 80 % HP and MP, for at most 90 s.
- A monster that attacks us is still fought.

**Heal-up before a costly fight** (solo): before pulling a level-2+ monster, the fighter drinks until HP covers the expected loss of the fight plus 30 % of max HP (`targeting.live.soloHpUse` 0.7). It does this for at most 90 s.

## 10. Choosing where to farm

`targeting.currentFarm()` decides the farm target. The first source that applies wins:

1. **A live event or world boss** ([§17](#17-events-and-world-bosses)).
2. **The leader's target** (for party members).
3. **A Monster Hunt** ([§18](#18-monster-hunts)), if `hunts.enabled`.
4. **A drop route** ([§19](#19-drop-farming)), only when no farm target is forced in config.
5. **A Cavalry plan** (reset or nuke a spot, [§15](#15-cavalry-tracktrix)).
6. The current target is kept until the next refresh (`targeting.refreshMs`, 5 min).
7. **A forced target:** `team.farm[name]`, else `targeting.farm`. With a list, the first entry that is not crowded, recently died at, or taken wins. A single forced monster is used even when blocked.
8. **The progression guide** (`get_progression`):
   - **Team model** (party leader): every walkable guide route that the [team model](#11-safety-checks) accepts, sorted by XP per second. The first one that is not crowded wins.
   - **Otherwise:** the guide's safe routes, the top 3 by XP per second, minus those a member objects to. Then the first one not crowded, otherwise a spare safe route.
9. **Fallback:** `targeting.fallback` (`goo`).

A change is logged as `[target] farm target: X (source)`.

**Rare monsters** (`targeting.rare`: golden bat, cutebee, tiny pinky, wabbit, pink goo, snowman) are attacked first when they are free and within 400 px. Invulnerable ones are skipped.

## 11. Safety checks

The bot never pulls what it can't survive. Several checks work together.

**Per-member guide verdicts.**
- Every member sends its own guide's safe list to the leader every 60 s.
- A spot counts as safe when every member calls it safe. With `avoidTrial`, a "trial" route counts only once it is proven: 15 min of farming without a death, or a harmless monster (every fighter survives 20 hits).
- An objection on the current spot must last `objectionGraceMs` (5 min) before the team leaves. A death counts at once. A death closes the monster that killed it (by damage, reported by the dead fighter) for an hour - since v1.219.2 the leader's own fallback check (a dead member near a farm monster) waits 15 s for that report and never adds the farm monster on top (a Fire Spirit death next to the Giant Scorpions used to close the gscorpion spot too).

**Team model** (`targeting.teamSafety`, the party leader). A spot is safe when the party can take it together. The "tank" is the sturdiest warrior or paladin; without one, it is whoever pulls (the leader), since v1.202.0:
- **Pull size:**
  - aggressive monsters (attack on sight): 3;
  - monsters pulled one at a time (isolation): 2;
  - others: 2;
  - passive ones (`pullPassive`): 1;
  - dense spawns (`denseArea`): the whole pack.
- **Checks:**
  - The tank survives 6 volleys of the pull (net of healing).
  - Incoming damage per second stays below the priests' healing × 1.5.
  - The HP lost over the whole fight stays below half the tank's max HP.
  - Everyone else survives 3 hits.
- **Kiteable monsters** count with only `combat.kite.farmRisk` (25 %) of their damage (`util.kiteRisk`). A monster is kiteable when it is slower than 0.9 × our speed and its range + 50 is below ours.
- `/safety [map]` logs every verdict.

**Live check for grown monsters** (`targeting.live`, level 2+). Monsters gain levels on spots that are not farmed, so their real stats are checked before a pull:
- **leader:** the team model with the live stats;
- **member:** survive 6 real hits;
- **solo:** the HP lost over the whole fight (damage minus potions and own healing) stays below 70 % of max HP.

**Isolation** (`targeting.isolation`). Monsters that join fights (aggro and rage ≥ 0.3) are pulled only when no other free one stands within 120 px of the target or of our way there. Otherwise the leader waits at a watch point outside the spawn box (`waiting for a lone X`).

**Spot check from the edge** (`targeting.spotCheck`, v1.201.0). Whoever picks the spot (solo, leader) stops at its edge before walking in:
- The edge is the spawn box (the rage box if the spot has one) plus the monster's range + 50 px, kept between `margin` and `maxMargin`. Both are 150 px now, so the edge is always 150 px out: monsters only join on contact or in their rage box, and from 450 px the 4-booboo spawn was out of sight.
- It watches for 3 s (`checking the X spot`) and judges what is in sight:
  - **rage zones** (since v1.235.4 only map rage zones - `aggroPack: false`; before: aggro and rage ≥ 0.3 too. Server: aggro is an attack on touch within 32 px, rage how long a monster pursues; the stoneworms (aggro 1, rage 1, no zone) come one by one and were wrongly judged as a pack of 4): all free ones come at once, so the pack check runs with the strongest of them (team model as leader, own hits and sustain solo). There is no "harmless" shortcut, because 20 single hits say nothing about 3 booboos at 1.2 hits/s each;
  - **passive kinds:** at least one of them passes the live check, and the largest group of free ones standing close (chained within `groupGap` 60 px, edge to edge) passes the pack check as one pull (v1.213.0). One at a time each X-scorpion passed ("6 of 6 fine", levels 10-11); the warrior's splash pulled 6 and he died. **Off since v1.233.1** (`spotCheck.groupRule: false`, player decision 2026-11-24): it judged 8 CGoos (rage 0, aggro 0.1, speed 9) as one pull from the edge; the splash users check their pull live (mage Blaster, warrior splash, Agitate via the team model).
- **Fails:** that spot is blocked as too strong and the next spawn of the kind is tried ([§12](#12-crowded-taken-and-too-strong-spots)). Log: `X spot <map> <x>,<y> too strong (...) - trying another X spot`.
- **Passes:** `spot check X: OK - ...`. No new check until we leave the map or the target changes.
- While the check is open, no free monster of the kind is picked and the warrior doesn't Agitate. Monsters on us are still fought.

**Mobbing** (`targeting.mobbing`, v1.202.0). A server rule (`server.js`, `commence_attack`), confirmed with a test on 9 goos:
- **Trigger:** more than 3 monsters target one player. Distance doesn't matter: a monster counts once it has taken the player as its target, for example right after Agitate.
- **Combo:** every hit that lands on that player raises a combo counter. The server sends it as `mobbing` in the hit event. It resets after 5 s without such a hit.
- **Multiplier per hit:** 1.62–2 for combo 2–10, then combo ÷ 4. The cap is max(300 ÷ the monster's attack, 1.2). In a mob every hit counts like about 300 raw attack, so **weak monsters get the biggest multiplier**:
  - iceroamers (120 attack): 2.5×;
  - bats (80): 3.75×;
  - goos (6): went from 8 to 76 per hit in 18 s in the test.
- **In the checks:** all pack checks count it, with the combo built up over the fight by the hits that land. This covers the solo pack check and Agitate, the solo live check for dense packs, the team model (on the tank, or on the puller without a tank), and the spot check. "Harmless" holds only for up to 3 at once.
- **Guard:** no new free monster while 3 are on one of our fighters (`maxOnOne`). The exception is a monster where mobbing adds at most 1.25× (attack 240+). Log: `not pulling X: 3 already on Y`.
- **Live (warrior, solo):** the warrior reads the real combo from every hit and carries it 4 s ahead (`projectSec`). Below 70 % HP, with more than 3 on it and a time-to-death under 8 s, it escapes (`escapeMobHp`, `escapeTtdSec`). It doesn't Agitate while the mob would kill it within 20 s (`mobStopTtdSec`). The escape ends only once the combo has run out.

**Rage zones** (`targeting.rage`, v1.203.0). Some spawns have a `rage` box in the map data (today in Spookytown: the mummies and both booboo spawns). Every 4.2 s, every monster of such a spawn takes a player standing in the box as its target. That happens wherever the monster is and whether you attacked it or not (`server.js`, `rage_logic`).
- **Counted as a whole:** the live members in and around the box, at least the spawn's `count`. They are judged with the strongest of them by the pack check (mobbing, fear) or the team model. A member uses the team model when the leader is within 300 px or stands at the zone (within 150 px of the box, v1.210.6); otherwise it judges the zone alone.
- **If that fails:** no monster of the kind is picked when it, our stand point or the straight way there lies in the box. Log: `not going into the X rage zone`.
- **Standing in such a box** (waiting, resting, handover): the fighter steps out first. Not while a path walk passes through, and not for a member whose leader farms that very spawn.
- **Cavalry reset:** the call goes out from just outside the box instead of its middle. The sentries only take level 3+, and the level-1/2 booboos would come at us.
- Why: three booboo deaths on 2026-11-22. Each time one booboo was picked and all 5 came (terrified, dead in 7 s).

**Wall fallback** (`travel.rageWallSteps`, v1.210.1). The rage walls can shut a fighter in: priest and warrior stood in the strip between the mummy zone and the big booboo zone, and every walk ended in "Path not found!". A failed path search (any `smart_move`: travel, following the leader, revives) now narrows the margin step by step (100, 50, 0 = the box itself, then walls off) and plans the walk again. A finished walk, a walk that fails even without walls (the goal itself is unreachable), or 2 minutes bring the full margin back. Since v1.210.2 every rage zone on the way is a wall, not only the ones the team can't take (with the warrior next to him the booboo zone counted as takeable, and the priest walked right through it). Open stay the zone that holds the walk's own goal, and (v1.210.5) the zones of our own farm target the team can take: the priest could hardly step into the accepted 4-booboo zone.

The margin is `rageMargin` 100 px: aggro checks the neighbouring 32-px grid cells, up to about 64 px from a monster at the edge. (Before the walls, a route guard detoured after the path was planned; it went round in circles and was removed in v1.212.0.)

Normal aggro is different: a monster with aggro only attacks a player who passes within about 32 px in front of it. Isolation covers that. Monsters also give up a chase after 20 s without being attacked (by chance, depending on `rage`).

**Fear** (server rule, v1.202.1). More attackers of one damage type than our courage for it (`courage` physical, `mcourage` magical, `pcourage` pure) cause fear:
- attack drops to 60/40/20 %;
- speed drops by 20/40/70/80/90/100.

The solo pack checks count the attack loss when a pull goes over our courage. Since v1.203.1 the team model counts it for the tank too; fighters report their courage with their stats. The escape uses the real (slower) speed while scared. The warrior has pure courage 2, so 3 booboos already scare him. **Fear guard:** no new monster is pulled while the attackers of its damage type already reach our courage.

**Learned hit factor** (`targeting.hitFactor`, v1.201.0). Every hit a fighter takes is compared with the formula (attack × damage multiplier of our armor/resistance minus its piercing):
- Per monster kind, from 8 hits on, all checks multiply its hits by real ÷ predicted damage (at least 1, at most 5).
- All fighters' hits count together (`bot_hit_factor:<name>`). Above 400 hits the sums are halved, so old hits fade.
- `/safety` lists the factors at the end.
- Mobbed hits (with `mobbing`) are not learned, because the mobbing model covers them.
- Why: iceroamers hit for 337–365 where the formula says about 150, after Agitate pulled four of them. That turned out to be mobbing, so the factor is now only a safety net.

**Damage return.** Melee classes (warrior, paladin, rogue) never hit monsters with `dreturn` ≥ 20 (`targeting.melee`).

**Deaths:** see [§22](#22-death-handling).

## 12. Crowded, taken and too-strong spots

**Taken by another player.**
- Another player's character within 300 px of our spot for 20 s takes the spot. We then leave it alone for 60 min (`occupiedForMs`).
- **Shared, not taken:** while we had a target at least 75 % of the last 2 min (`stayIfBusy`), we stay. Walking counts as idle.
- A taken spot we stand on with no foreign fighter for 30 s is free again.

**Crowded.**
- No free target for 90 s, or idle 70 % of a 3-min window, makes the spot crowded.
- The guide's next choice is then used for 60 min. The block doubles on each repeat within a day, up to 6 h.

**Too strong** (v1.206.1).
- **One spot:** a spot that fails the [spot check](#11-safety-checks) is blocked on its own until the Cavalry is ready: at least 10 min, in memory only (without the Cavalry: `crowdedForMs`). The next spawn of the kind is tried.
- **The whole kind:** when every spot of a kind fails, or the grown monsters in sight all fail the safety check, the kind is blocked until the Cavalry is ready to reset it ([§15](#15-cavalry-tracktrix)) (`bot_strong_spots`, log `X too strong here (...)`), and a hunt on it is skipped ("every X spot taken or too strong"). Without the Cavalry the kind is skipped like a crowded spot instead.

## 13. Picking the next monster

1. A **rare monster** in reach.
2. The **current target**, while it is still valid. It is dropped if it is now fought by another player (cooperative bosses excepted), doomed, or no longer isolated.
3. The nearest monster **attacking us or a party member**.
4. In a **join event**: the nearest wave monster.
5. **Members:**
   - the event boss;
   - their own nearest monster if the leader's target is **easy**: it hits for at most 2 % of our HP, or dies in 3 of our hits and hits for at most 5 % (`party.spread`);
   - otherwise only the leader's target, and only once it is engaged. Members never open fights.
6. **Leader or solo:** the nearest free, safe, isolated monster of the farm type that is not on a taken spot.

**Holding a boss.** In a party, an unengaged boss on `events.holdFor` (empty since 2026-11-22), or one too strong for this fighter alone (solo boss check, kiting included), gets no first hit until every living fighter is within 350 px. A boss already fighting someone is attacked at once.
- **Aggressive bosses** (aggro or rage ≥ 0.3, e.g. Jr.: aggro 1, rage 1), since v1.204.0: the fighter waits **outside the boss's spawn box**, by its range + its charge (or speed) + 50 px. Status: `waiting outside the X spawn`.
- That ring counts as "here" for the team as well. If the boss leaves our sight, the ring is kept for a minute, so nobody walks into the box looking for it.
- Why: on 2026-11-22 the ranger waited inside Jr.'s box, Jr. walked into him, and the fight began without the team.

Monsters fought by other players are never taken, except cooperative ones (Phoenix, Jr. …), where everyone who hits gets a reward.

## 14. Kiting and spacing

**Kiting** (`combat.kite`). A fighter that outranges an attacker by 30 px and is faster than it (its charge speed below 0.99 × ours) stands on a circle around it and only moves while inside.
- **Circle radius:** its speed + its range + 50, at most our range − 10.
- **Avoid:** points near free monsters (120 px), and points within the reach of monsters of other kinds than the farm target + 50 px (`kite.foreignMargin`, v1.218.0 - Fire Spirits, range 280, next to the Giant Scorpions). Escape points too.
- **Bosses:** kiting stays within 280 px of the boss's spawn area.
- **Solo spot safety** (v1.226.8, `targeting.soloOwnCheck`): alone, a route the guide calls unsafe is taken when our own solo check passes for the level-1 monster - we survive `live.ownHits` of its hits and the fight costs at most `live.soloHpUse` of our HP, a monster we can kite hitting with the residual risk only (the guide knows no kiting: it kept the mage off the Huge Crabs, speed 8). No bosses, no special abilities. The pack check (spot check, Agitate, splash) counts a kiteable monster the same way since v1.227.1 (two Huge Crabs together had blocked the spot). A Cavalry reset that finds nothing of level 3+ at the spot (any reset since v1.227.2, before only hunt resets) lifts the too-strong block after 20 s and lets the spot check judge again; no new reset for that monster for 10 min.
- **Normal monsters** (v1.225.2, `kite.farmAnchor`): kiting may leave the spawn area, but stays within 250 px of the monster's nearest spawn box (`farmAnchorMargin`) - room to kite, not far away. Without it the new mage kited Porcupines far from their spot.
- **Cornered:** the fighter looks for an escape point; if there is none, it stands and fights.

A single attacker that can't be kited switches kiting off. The warrior (range 38) never kites. Check a monster's `charge` in `G.monsters` before tuning: the Phoenix charges at 65, faster than a ranger.

**Spacing** (party, `party.spacing`). Ranged non-tanks keep out of the monsters' melee reach (their range + 50) while a tank is near. Other kinds than the farm target: out of their whole reach + 50, not capped at our own range (v1.218.0: the priest stood towards the Fire Spirits, the pulled scorpions came his way and the fight drifted into their reach).

**Too-strong spots:** see [§12](#12-crowded-taken-and-too-strong-spots).

## 15. Cavalry (Tracktrix)

The Tracktrix (`tracker`, kept in every fighter's bag) calls the Cavalry. It is strong while the account's highest level is below 80.

**Emergency** (`cavalry.emergencyHpBelow` 0.35). Below 35 % HP with a level-3+ monster on us, the Cavalry is called at once.

**Reset of a grown spot** (`cavalry.reset`, **off since v1.227.3**, player decision 2026-11-23): grown monsters that pass the spot check are worth more (the monster level multiplies the drop chance, XP and gold grow too), so the Cavalry is no longer spent on them. It is still called in an emergency, for a spot the spot check blocked as too strong (planned reset, below) and for a hunt held back by such spots. With the switch on again:
- **Who:** the spot picker, not during events.
- **What counts:** grown farm monsters, level ≥ 5.
- **How:**
  1. The fighter waits until at least `resetPackMin` (5) grown monsters are in reach (320 px), or all it can see.
  2. It walks to the middle of the densest group (`to the pack (Cavalry)`).
  3. It calls there, or when stuck, or when attacked.
- **Guard:** no call while another player fights a monster in reach. Every other kind in reach must pass the safety check.
- **Afterwards:** a successful reset clears the spot's crowded, strong and death blocks.

**Hunt reset** (v1.208.0). An open hunt held back only by too-strong spots, with the Cavalry ready, works like this:
- The Cavalry resets the spot of that kind that the team could take with **fresh level-1 monsters**: the whole spawn at once where it comes at once, checked by the team model or the solo pack check.
- The team calls from just outside a rage box, never from inside.
- After the reset the spot is free again, and the hunt is done there.
- With nothing of level 3+ at the spot after 20 s, the spot check decides as it is.
- Log: `Cavalry ready: reset at the X spot ... for the hunt`.

**Plans** (`cavalryPlan`). A too-strong or crowded first farm target is reset as soon as the Cavalry is ready. `cavalry.targets` (empty) would name spots to nuke for their loot.

The cooldown is shared by the account (`bot_cavalry_next`, at least 10 min).

## 16. Party play


**Farm radius** (`party.farmRadius` 400, v1.217.4): a member picks free monsters only within 400 px of the leader (same map); monsters already on it are fought wherever they are. Without one in reach it goes back to the leader. Why: in the bat cave the warrior, back from a restart, streamed from clump to clump ~1,000 px away from the priest and never returned (the follow leash on the same map was removed 2026-11-21).
**Leader.**
- Invites missing members every 10 s.
- Broadcasts its position, farm target, target, route end and event every 2 s.

**Members.**
- Accept invites only from the leader and leave any other party.
- **Follow:** with `party.goToDest`, members walk to the leader's route end themselves ("going ahead"). A route end inside the leader's farm spot is not sent (they would stand alone in the spawn) - then they follow the leader. At the last route end they wait while the leader stands for up to 30 s ("waiting … ahead"); since v1.234.1 only while it really stands - they had waited at Daisy while the leader walked on to the CGoos. **Team goal** (v1.236.0, player decision 2026-11-24, replaces the "at the spot" hold and the mage's "going ahead" of v1.235): the leader sends the END goal of the team's route as its own field (`goal`: id, kind, name, map, x, y, reached) - never a door, map edge or waypoint. Kinds: `spot` (a farm spot, set by the leader's walk to it, `fighter.travel`), `boss` (the leader's boss event, where the boss was seen), `daisy` (`hunts.visitDaisy`) and `search` (a boss search: everyone walks its own areas - no goal to go ahead to or port to). A new goal gets a new id, also the same spot again after a boss in between. Every member walks there on its own path - a farm spot to its edge point, never into the spawn (the spot check is the leader's), Daisy to her - and waits there ("at goal, waiting: …"; no free pulls meanwhile, attackers are fought) until the leader is there too (`reached`); then the usual rules go on. There means: a spot - inside its area or within `party.goalEdge` (250) px of its edge point; Daisy or another point - within `goalRadius` (200) px. Bosses: the boss logic walks everyone (events/targeting). It works for any leader and any team - without a Magiport caster everyone just walks.
- **Assist:** they attack the leader's target, or their own easy targets.
- **Detached:** a melee member farms on its own while the leader farms a damage-return monster.

**Team wait** (`party.waitForTeam`). The leader stops while a fighter is more than 500 px away or out of sight, for at most 45 s per separation.
It does not wait:
- while something attacks the team;
- on a boss or a route;
- for the boss runner;
- for dead members;
- for members strong enough to pick their own targets there.

**Chest opener** (`party.chestOpener`). The chest's gold uses the opener's gold bonus, so the fighter with the highest `goldm` opens. The others open only when it is dead, out of sight, more than 400 px away, or after 10 s.

**Damage meter** (`meter`). The leader (or a solo fighter) logs `[dps]`: the real damage per second per member over the last 5 min (`windowMs`), from the game's hit events, every 5 min (`everyMs`). `/dps` prints it now.

## 17. Events and world bosses

`server.status` tells which events are live; `events.observe` logs every change (`[event] live now: …`). `events.policy` decides per event (`"always"` / `"never"`). A boss on `"never"` is neither searched nor engaged when seen (VizMage's solo run since v1.225.3: both Draculs, Jr., Green Jr., Skeletor; the Phoenix is on again since v1.226.0 - searched by the merchant, not hunted nonstop since v1.226.7). An event counts only when every fighter has reached `events.minLevel` and the boss check (below) says the team can win.

**Event kinds.**
- **Join events** (Goo Brawl, Graveyard): every fighter joins and takes its own nearest wave monster.
- **World bosses with a position** (Snowman): the team travels there and fights.
- **Roaming bosses:**
  - `events.search` (Phoenix): the team searches all spawn areas every `searchEveryMs` (20 min).
  - `events.engage` (Dracul, Ms. Dracul, Jr., Green Jr.): fought whenever met, and searched by a runner. Ms. Dracul (`fvampire`, v1.216.1): 240k HP, 875 magical, one spawn in halloween, drops Dracul's Attire (1 %); alone the runner holds for the team. Skeletor (`skeletor`, v1.218.1, trial): 80k HP, no armor, 1,800 physical at 1.2/s, 120k XP, one spawn in the arena (cgoo area), back after 16 min.

**Boss check** (`events.boss`). From the team's real stats:
- every fighter survives 6 hits (`boss.minHits`); with a tank (warrior/paladin) in the team the others need only 4 (`minHitsNonTank`, v1.216.2 - Ms. Dracul hits the ranger for ~800, 4.4 hits, while the warrior tanks her; kiting in tight spots like Dracul's cave doesn't work); per boss `minHitsNonTankBy` (v1.218.2: `{ skeletor: 2 }` - the ranger survives 2.1 of his hits, the priest 2.8);
- the damage on the tank stays below the priest's healing × 1.5 (solo: 150 HP/s sustain);
- a fighter that can kite the boss counts as taking no damage;
- `maxFightMinutes: null` sets no kill-time limit.

A visible boss is checked with its live stats (bosses grow).

**Search** (Phoenix).
- The leader walks every spawn area and looks around 4 s at each. Any watched boss in sight ends the search.
- After a kill, a slow boss (respawn > 200 s) is searched again at kill + respawn × 0.72. The Phoenix respawns after ~32 s at a random spot.
- A kill is seen through the game's `death` message (own listener `__botBossDeathFn`): the boss fight ends at once. Without it a boss ends 30 s after it was last seen ("gone without a kill seen"). A boss that is done is booked (journal line, next search by its respawn) before another reported boss takes its place (v1.236.1: Ms. Dracul died while the merchant's Skeletor report waited - the Skeletor replaced her at once and her kill was never booked). v1.227.5-v1.232.0 lost that listener to the kill log's of the same name - every boss ended by the 30 s timeout, and the respawn rule above never ran (fixed in v1.232.1).
- **Parallel search** (party, `splitSearch`): the leader splits the areas between the fighters. A finder reports, the team meets at the finder, and the leader waits at most 4 min for the others' areas.

**Runner** (`events.runner`, party only).
- **Who:** the fastest ranged fighter (never the leader or a healer). It searches Dracul (every 20 min), Ms. Dracul (every 25 min), Skeletor (every 20 min), Jr. and Green Jr. (every 60 min) alone while the others farm on.
- **On a find:** the runner reports it and the team comes. Like the Phoenix, the runner opens the fight alone when its solo boss check (kiting included) passes; otherwise it holds outside the boss's spawn box until the team is there (`holdFor` is empty since v1.209.2).
- **Nonstop:** `farmBosses` would make the runner hunt a boss nonstop (off).

**Drop hunts** (`hunts.dropHunts`, v1.223.0, player decision). A Monster Hunt is taken when its monster is among the top `xpTop` XP spots **or** drops something on the merchant's shortage list - a wished item or a craft ingredient (all entries, not only the 8 the drop routes look at), any chance - from the monster's own drop table and, since v1.223.1, the map drops of every map it spawns on (stat rings in winterland/winter_cave, amulets in halloween, belts in spookytown, through the "open" tables). Safety and time checks stay. Log: `hunt bee taken for its drops: beewings (1.0 %, 60 missing) (XP rank #37)`.

**Giga Crab** (`events.policy.crabxx: "always"`, v1.222.0, player decision). Daily, 40 min, on the main beach; `join("crabxx")` puts us at main -1000,1700 (`joinSpot`: counts as joined within 600 px). 960k HP, **16,000 physical every 3.3 s** (one hit kills priest or ranger, ~9,600 on the warrior), speed 80 while it has a target, rage 0 (keeps its target). While Huge Crabs live it takes 1 damage per hit (`"1hp"`). Our rules:
- **Go** only while the boss check passes for its Huge Crabs (`joinNeeds: { crabxx: "crabx" }`; 4,200 HP, 240 physical).
- **Targets** (`joinTypes`): Huge Crabs and the Giga Crab - the Giga Crab only while a **foreign** player holds it and it takes damage (`foreignOnly: { crabxx: "1hp" }`: never free, never on one of us, never while `1hp`). A Giga Crab on one of us is never hit either.
- **Safety** (`foreignRules.crabxx`, v1.230.0, player decision 2026-11-24): the priest never hits it (`neverBy`); the others only while the foreign holder is visible, has at least 40 % HP (`holderMinHp`) and stands within 400 px of it (`holderMaxDist`) - a holder that dies or leaves hands it to the next hit. Public server code (March 2026): with `1hp` every hit is 1 coop point, otherwise the damage is; home-server characters (EU IV) get x5.
- **Flee** (`flee`, `fleeStep` 250): whoever it targets steps 250 px straight away from it every tick (free direction closest to it), the mage by Blink, and does nothing else meanwhile (`fighter.gigaFlee`). It keeps its target and charges at 80, so only the warrior (one hit) has real odds - the rules above are the real protection.
- **Never touched by area skills** (`noArea`): no Taunt on it, no Agitate with it within 320 + 80 px, no Cleave/Stomp with it near, never in the ranger's 3-Shot, no Absorb Sins on an ally it targets (luck catch too).
- Drops (game data): Fun Tokens (weight 1000 + 2x 10), seashells, crab claws, a shell; achievements +1 luck at 100 kills.

**Witch's Cipher farming** (`events.witchCipher`, v1.221.0, player decision). The four ingredients (verdantspore, frostscale, embercoal, gloomfeather) drop only in the event's 20-minute gathering phase, 0.3 % per 1,000 monster HP at luck 1 - so the yield follows our damage, not the spot (~15 per round). From `leadMs` 10 min before a round (read from `server.status.schedule`) until `gather_end` the leader farms the ingredient the merchant reports as scarcest (bank snapshot + its bag, `bot_cipher_stock`; ties at random, fixed per round): the first spot of `spots[ingredient]` the safety checks do not block, above hunts, drop routes and the guide; meanwhile no roaming bosses, boss searches (team, runner, merchant) or Daisy trips. No report: `fallback` (embercoal). No ingredient is sold (embercoal left the sell list in v1.220.5). Brewing at the Witch comes later.

**Cave of Many Dreams, manual mode** (`config.cave`, v1.231.0, player decision 2026-11-24; `core/cave.js`, slot 41 `bot_cave`; game facts and all 50 encounters in [docs/cave-of-many-dreams.md](docs/cave-of-many-dreams.md)). The player enters at Dorr - the bot never calls `cave_enter()` - and walks the leader outside fights. While `character.cave` is set and `mode` is `"manual"`:
- **Fights** only what the player starts (a target set on the leader by hand: the leader's current target) or what attacks the party; members also take the leader's target. Never a free pull, rare monster or spot walk (`targeting` farm `cave`); the leader stands still outside fights, kiting and covering work as usual in a fight. `neverFight` (Dark Mage) is never attacked.
- **Off in the cave:** events, boss searches, supply calls (the merchant's call too), Daisy, Cavalry, rage-zone walks, magiport; Agitate, Cleave and Stomp (`noArea`: `util.noAreaNear` answers "yes"), the mage's Blaster (staff and book back). Nothing at all while the cave is paused (a vote). No respawn of our own (Nera: free at the doorway, 1 Amber in place - the player decides).
- **Votes:** every member votes what its leader voted - the leader's `cave_request("vote")` (by hand in the UI or by code) is wrapped and sent as a CODE message `cavevote`; a leader vote found in the cave state wins. Members never vote on their own.
- **Chests:** everyone opens cave chests within 400 px (cave gold and Amber go to the shared purse).
- **Recorder** (`record`): cave states (`character.on("cave")`), every cave request and its result, and every `entsEveryMs` the cave's monsters/NPCs with all flat fields - in the storage `bot_cave_rec:<name>` (leader 400 entries, members 150), for the later automation. Since v1.231.5 a state is kept only when more than the clock changed (the first run filled 236 of 300 entries with one-second clock states), without the phrase objects, up to 12,000 chars; every reward goes in once as a `reward` entry; entities keep only game fields; a full storage drops the oldest half.
- **`/manual [on|off]`** (v1.231.1, chat command in the leader's client): the same fight rules outside the cave, so the player can walk the leader (e.g. to Dorr) without stopping its code. The leader keeps broadcasting its position (field `manual`), the members follow it across maps and use the same rules. Kept across code loads (`bot_manual:<name>`) until `/manual` again; no events, supply, Daisy or Cavalry meanwhile, and no Agitate, Cleave or Stomp (v1.231.2, `util.setNoAreaHook`). Switching it off picks a farm target again at once (v1.231.2). Respawn and chests stay normal outside the cave. Healing walks of the priest stay (a hurt member counts as a fight).
- Entering: whether every member must choose Enter at Dorr itself is unknown until the first run - start warrior and mage in their own clients beforehand.

**Merchant search** (`events.scout`, v1.220.0, player decision; `roles/scout.js`, slot 40 `bot_scout`).
- **Lists:** the merchant searches the bosses on `scout.bosses` (Phoenix, Dracul, Ms. Dracul, Skeletor, Green Jr.); the runner keeps `runner.bosses` and searches Jr. (Spooky Town: rage zones, Vampire Rats on the way). The three fighters stay at the farm spot and only leave when the merchant reports a find.
- **How:** the leader keeps the search timers, pauses and boss checks and writes the due bosses into the shared storage (`bot_scout_plan`). The merchant walks a round over their spawn areas after pickups and deliveries, before its chores (maps in `mapOrder`, nearest area first, areas within 150 px of each other once). A boss in sight stops the walk; it is reported like a member's sighting (the team walks to where the merchant stands). **Report and walk on** (v1.220.2, player decision): the merchant sends the find every second for `reportMs` 3 s (a step to `keepAway` 250 px first when closer) and goes on with its round. The leader holds a merchant's report up to `holdMs` 3 min instead of a member's 10 s (the walk from the farm spot takes 60-90 s; at 06:09 the team turned back after 32 s) - or until one of us stood within `arriveRadius` 300 px of the reported boss for `arriveGraceMs` 10 s without seeing it (gone); our own sightings take over on the way. Bosses on `scout.watch` (empty) are watched instead: the merchant keeps `keepAway` px and reports until a fighter is within `teamNear` 300 px, it is gone (`lostMs` 8 s out of sight, meanwhile it walks back toward the last spot) or `watchMs` 3 min ran out. After the round it reports each boss (`scoutdone`); not found (or found but not engaged): searched again on its timer. Only a boss whose areas were all walked (or that was found) is reported - a round cut short leaves the rest due (v1.220.4); the leader writes the plan every tick, also during its own searches and fights.
- **Fallback:** the runner / the team Phoenix search step in as before while the merchant is not available (no heartbeat on our server for `freshMs`, Ponty round, trade trip, paused for `pauseAfterDeathMs` after dying on a round) or a boss is overdue by `fallbackMs` 10 min (a boss on the merchant's running round counts as its job for `lapMaxMs` 15 min).
- **Safe walking** (`scout.safeWalk`): every path walk of the merchant (also pickups, bank, Ponty) plans around aggressive monsters in sight without a target (`pad` 100 px: aggro picks players within the neighbouring 32-px cells only), rage zones and the `travel.wallMonsters` spawns (`ragePad` 100). Since v1.220.3 (player decision) only monsters that kill the merchant in `hits` 2 hits count (their hit on it with its armor/resistance, x1.1, times 2 reaches its max HP): with 1,400 HP Skeletor and Ms. Dracul, not bats, CGoos, Fire Spirits, Dracul or the Phoenix - every aggressive kind had walled the cave and arena paths. Rage zones always stay walls. No path with the walls: walls off for `offMs` 60 s and the walk is planned again. Log tag `[scout]`.

**Pause after a death.** A fighter dying within 600 px of a boss pauses that boss for 3 h (`pauseAfterDeathMs`). A death elsewhere does not. `/phoenix` (etc.) lifts the pause.

During a boss fight Daisy trips are aborted, and the fighter fights the event's boss without a leash.

## 18. Monster Hunts

`hunts.enabled` (off in solo). A hunt is taken only when every fighter has reached level 20 (`minLevel`) and all of these hold:
- it is on this server with kills left and more than 2 min left;
- it is safe for the team (the same check as farm spots; `allow` / `deny` override);
- the monster is among the team's **top `xpTop` XP spots** (0 = every safe hunt; 5 again since v1.217.6 after a short test with 0);
- the remaining kills fit in the time left (team speed from the guide).

The hunt expiring first wins. A hunt whose kind is blocked - too strong at its spot and waiting for the Cavalry, or crowded - waits meanwhile and the team farms its normal target (v1.235.3: the stoneworm hunt was picked again every 3 s, the spot check blocked it again, and the team stood idle there).

**Daisy trips:**
- A finished hunt is turned in at once (Monster Token).
- New hunts are fetched at most every 10 min, when someone has none and nothing is huntable.
- The leader waits up to 45 s at Daisy for the members.

## 19. Drop farming

Items that can't be bought come before XP when they are worth more (`drops`).

1. **What is missing.** The merchant reports, every 5 min, the wished items it lacks copies for, plus `drops.want` (50 Armor Boxes).
2. **Routes.** The leader asks its guide and the game's drop tables where each item drops. Only team-safe routes that take at most `maxHoursPerCopy` (100 h since v1.232.0, player decision 2026-11-24 - a sanity cap; was 4 h) per copy are kept. Bosses are excluded. **Luck** (v1.227.0): every route's chance counts `luckm` × the encouragement luck bonus (`character.encouragement.totals.luck`: Welcome Back, Lone Wolf). Server: each roll is chance × luckm × monster level; the bonus is one extra roll per contributor with share × (bonus − 1) and his full luckm - solo exactly luckm × bonus. In the party (v1.227.5) the sum is counted exactly: the normal roll with the luck of each kill's target at death (kill log, last 10 min - the luck catcher's share), plus (bonus − 1) × each member's damage share (meter, last 5 min) × its own luckm; members report their luckm with the goldm message. Heal points, which the server counts as contribution too, are not in the meter, so the estimate errs slightly low. The guide's rates are the plain table values, so the factor applies to its routes too (before only our own table routes, and only solo).
3. **By value** (`byValue`). The leader compares the XP spot with each drop spot: XP value plus gear value (the wish's gain per hour). A drop spot must be worth `valueSwitch` (1.2 ×) the current choice to switch.
   - Log: `[drops] value: XP spot X%/h vs <monster> Y%/h -> …`.
4. **Spot gold** (`spotGold`). Every fighter measures its loot gold per farm target over 3 h, but only while the whole team farms together. The merchant prices buy orders from these numbers ([§32](#32-money-pots-budgets-and-prices)).

## 20. Fighter gear: wishes and equipping

**Wishes.** Every 5 min, and at once after a gear change, each fighter sends the merchant:
- **its wish list:**
  - the progression guide's requests (up to 12);
  - the class chains from `gearPlan.wishes`;
- what it wears, its class, its XP value, and whether it carries a Tracktrix.

**Class chains** (`gearPlan.wishes`, gear plan v2 since v1.219.0 - the per-class overview is `docs/gear-guide/gear-plan-v2.pdf`, built by `scripts/gear-plan-v2.mjs`; `{stat}` = the class's main stat):

| Slot | Chain | For |
|---|---|---|
| cape | Cape +0 (40 Leather) | all |
| shoes | Winged Boots +7 | non-tanks |
| shoes | Rugged +7 → +8 → Winged Boots +7 | tanks |
| offhand | Quiver +0 → +7 → +8 | ranger |
| orb | orbg +0 → +1 → Orb of {stat} (alt: Loaded Die) | all |
| ring | {stat} ring +2 → +4 (alt: Sucker Punch, ranger only) | ranger, rogue, mage, paladin |
| ring | STR ring +2 → +4 → Ember Seal +2 | warrior |
| ring | INT ring +2 → +4 → Glacier Seal +2 | priest |
| earring | {stat} earring +2 → +4 | all but the priest |
| earring | INT earring +2 → +4 → Moonshard Earring +2 | priest |
| amulet | {stat} amulet +2 → +4 | all |
| belt | {stat} belt +0 → +4 (alt: Knife Belt for the rogue) | all but the ranger |
| belt | DEX belt +0 → +4 → Wind Belt +2 | ranger |
| helmet, pants | Rugged +7 → +8 | tanks |
| gloves | Rugged +7 → +8 → Fiery Gloves +7 → +8 | warrior |
| chest | Rugged +7 → Dracul's Attire +7 → +8 (at most 3 tries a day) | warrior |
| chest, pants, shoes | Wanderer's pieces +8 (shoes alt: Winged Boots) | priest (chest opener) |
| gloves | Wanderer's Gloves +8 → Fiery Gloves +7 → +8 | priest |
| gloves | Thundergrips +7 → +8 (crafted from hunter gloves +6) | ranger |
| carried | 2 orange Lolipop Maces +7 (green ones stand in) | warrior |
| carried | Shield M +7, Rabbit's Foot, 2x Clover Stud (luck swap set) | priest |
| carried | Poucher +7, Alloy Quiver (held for a later AoE mode) | ranger |

**From the back** (v1.219.1, like the weapon lists): when the merchant holds a copy of a later item of a fighter's chain (a Dracul's Attire +0 in the bank), it works on that one at its first step's level instead of the wished earlier step; paused there, one item further to the front. **Tokens** (`workshop.tokenOrder`): Fun Tokens go to the Rabbit's Foot before the Shield M. **Fire weapons** go to +8 (`materialGoals` essence of fire `upTo: 8`, `gearPlan.weaponCaps`) before essence goes to the Fiery Gloves or Ember Seals.

Crafted compound pieces (seals, Moonshard, Wind Belt) are wished at **+2**: the first level that beats the worn +4 piece (+2 = 9 crafted copies). Weapons per class (`gearPlan.weapons`): the ranger's list is Bow → Hunting Bow → Fire Bow → Crossbow.

**Luck swap** (priest, `classes.priest.luckSwap`, v1.219.0): the priest wears its INT gear; right before Absorb Sins (luck catch) it puts on Shield M, Rabbit's Foot, the five Wanderer's pieces (+16 luck) and two Clover Studs (one per earring slot, v1.223.2) with one `equip_batch` call, and changes back 3 s after the last catch. Meanwhile the equip pass and the wish report pause; the best copies of each luck piece (as many as listed) and the swapped-out gear stay in the bag.

**Limits** (`gear.minLevel`, `gear.maxWorn`): Dracul's Attire and Heavy Underarmor are never put on below +7; at most one Zapper is worn.

Chain rules:
- A worn alternative pauses its chain.
- A piece of a later step counts for the earlier ones (a lucky drop skips ahead).
- `replace` chains wait until the shop gear is done (+8 armor, +8 weapons), unless marked `anytime`.
- **Item stages:** a level is wished only once every lower wish for that item is filled.

**Equipping** (one action per pass, at most every 3 s):
1. the guide's "equip" advice;
2. a better copy of a worn piece (higher level, or the right stat);
3. the next step of a class chain;
4. two one-handers over a two-hander;
5. a stronger weapon (`util.weaponPower` + 3 %);
6. any usable piece for an empty slot;
7. take off off-stat jewelry and `gear.noEquip` items (Hand of Midas).

**Weapon power** (`util.weaponPower`) = attack × class weapon bonus × frequency × **burn factor**. Fire weapons proc burn: about 4.8 × the hit over 5 s, counted at 80 % → `BURN_VALUE` 3.8 × proc chance. The priest is exempt (a heal never burns).

**Handing back.** Everything not reserved goes to the merchant on the next pickup, including the old piece after an equip. Reserved means one of:
- wished;
- a better copy;
- a carry item;
- a sword-swap sword;
- for an empty slot;
- new in the bag (< 20 s).

## 21. Supply: loot, gold and potions

**Pickup request.** A fighter asks the merchant to come (CODE message `pickup` with its position and potion needs) when:
- its potions are below 100 (`potions.requestBelow`);
- fewer than 6 bag slots are free;
- 20 min have passed since the last visit (`supply.pickupEveryMs`, 15 min until v1.219.4);
- or `/pickup` is typed.

While the merchant walks over, the fighter keeps farming and sends its position every 5 s.

**Handover.** When the merchant is within 250 px, the fighter stops and sends:
- gold above `supply.goldKeep` (10k), if at least 5k;
- every item stack except `supply.keep` (Tracktrix), class items (priest: Essence of Life, ranger: Poison Sack), reserved gear and current potions.

**Self-buying.** Below 20 potions with no merchant answer for 3 min, the fighter walks to town and buys up to 300.

**Elixirs** (v1.229.0, `config.elixirs`, player decision 2026-11-23):
- **One elixir per class** (`byClass`):
  - priest: Liquid Luck (+16 luck, 12 h);
  - mage: INT, warrior: STR, ranger/rogue: DEX, each at tier 0 (+6, 12 h).
  - Tiers 1/2 and VIT stay in the bank.
- **Fighter:**
  - carries `carry` (4, two days) of its own elixir, asked for with every pickup and never handed over; fewer than 2 in the bag call the merchant (v1.229.3, at most 5 min after its last visit, `callEveryMs`);
  - drinks one when none works or its own runs out within 10 min. The same elixir again extends the running one (server: + duration, the rest kept at 97.5 %).
  - Another elixir that works, such as a tier 1 drunk by hand, is left to run out.
- **Merchant:**
  - keeps the team's elixirs in its bag (never banked; banked ones come out on the next bank trip) and hands them out with the potions.
  - **Liquid Luck** (`buy.elixirluck`): below 10 in bag + bank, it walks to Warin (Wanderers' Inn; since v1.229.1 to the map's spawn point nearest to the seller - Warin stands behind his bar) and buys up to 30 at 240k each, with gold above `merchantRole.goldReserve` only.
  - **Stat elixirs** (`exchange`): once one of the team's stat elixirs is below 6, Seashells are exchanged until every one is at 20 (~2,100 Seashells on average, 2,900 in 99 % of the cases).
  - 40 Seashells always stay for Loaded Dice.
- **Seashells:**
  - a standing buy order at the stand: 900 each, up to 3,000 held (`market.buy`);
  - buying from players and Ponty (both up to 960) is a later step. Ponty sells whole stacks only.

## 22. Death handling

On death the fighter logs the last 10 s of hits (`[death] last 10 s: …`).
- **Blame:** the monster kind that dealt the most damage is blocked as a farm target for 1 h, stored across restarts (`bot_farm_experience`). A member reports it to the leader.
- **Respawn:** tried every 5 s. A priest about to revive us holds the respawn for 30 s.
- **Bosses:** see [§17](#17-events-and-world-bosses) (pause after a death).
- **Warrior Agitate:** see [§23](#warrior-classeswarrior) (Safety).

## 23. Classes and skills

Every skill checks its level, weapon type, MP and cooldown. Most keep an MP reserve (`mpReserveRatio`).

### Warrior (`classes.warrior`)

| Skill | When |
|---|---|
| **Hard Shell** | The predicted next physical hits × 3 reach our HP. |
| **Charge** | Whenever we walk (cooldown). |
| **Dash** | **Off.** Combat only, ≤ 49 px towards the target. |
| **Taunt** | A monster on an ally below 80 % HP, or hitting for ≥ 5 % of its HP, a boss, or anything on the priest. The warrior walks up first unless the ally is below 50 %. |
| **Agitate** (lvl 68) | 3+ monsters on allies, with no bystanders and no other kind than the farm target in reach. |
| **Cleave / Stomp** | 3+ / 2+ monsters around, never near damage-return monsters. |
| **War Cry** | Party: targets needing 4+ hits. Solo: before a pull-point Agitate. |

**Agitate pack mode** (solo, `classes.warrior.agitate`):
- **Automatic** (`monsters: "auto"`): the warrior decides per farm target. It is allowed only on monsters that pass a pack safety check (a pull may cost at most 35 % of max HP), are slower than us, have no damage return and no abilities. A running mode goes off on a live "no" (pack check or level cap for what is in reach) only after it held for `offAfterMs` (60 s, v1.215.0) - at the CGoos it flipped swords <-> off every 15 s as grown and fresh ones walked in and out of reach; every single Agitate checks what is in reach anyway. Fixed reasons (a death, damage return, abilities, speed, a new farm target) switch at once.
- **Splash or swords:** after 40 hits it learns the splash neighbours per hit. From 1.0 it uses the splash weapons (Lolipop Maces); before that it guesses from spawn density.
- **Splash without Agitate** (`splashOnlyFrom` 3): with 3+ on him the Lolipops go on even where Agitate is off - since v1.213.0 only when he survives what the splash would pull: those on him plus every free monster chained within the splash radius + `splashPullSlack` (40 px), three rounds deep. Party: the team model (healing counts); solo: the pack check's safe count. Log: `no splash: it would pull N (...)`.
- **Not on the way** (v1.213.1): while a path walk runs (an event call, a spot change, following the leader) the splash weapons come off at once and don't go on again - they slow us down, and leaving the Giant Scorpions for the Phoenix with the scorpions behind him, the warrior defended himself with the Lolipops past the Fire Spirits. Log: `splash weapons off: on the way`.
- **Stream mode:** Agitate on cooldown, with at most 5 monsters on us (fewer at low HP), walking to clumps.
- **Safety:** after three low-HP moments in 10 min it pulls fewer. A death within 90 s of an Agitate denies Agitate on the **killer's** kind for 2 h (`deathDenyMs`) - the kind that did the most damage in the last seconds, the same one the spot block uses (since v1.219.6; before, the farm kind was blocked: two Fire Spirits killed the warrior and the Giant Scorpions got the block). Killer unknown: no block.
- **Escape triggers since v1.216.0** (solo and party), besides low HP and the mob check: **real HP loss** - the HP actually lost over the last `escapeLossSec` (3 s; every hit, burn, heal and potion included) would kill him within 8 s; or a **monster rejected even alone** - one on him that the team model (party) or the pack check (solo) rejects as a single monster, e.g. a Fire Spirit ("abilities: burn"). Bosses never count as rejected. Why: a Fire Spirit pulled into the Giant Scorpions by another player killed him with "1 on me" - 17,262 damage in 10 s from stacking burn, which the hit formula doesn't know. The usual speed rule stays: he only runs from monsters slower than him.
- **Party escape** (`agitate.partyEscape`, v1.207.0): in a party the warrior runs too, but only when the live check says he dies within 8 s. The check includes the healing of every healer in reach (heal/s × `mobbing.healShare` 0.8). It applies with a mob (more than 3 on him, below 70 % HP) or below 30 % HP; low HP the priest covers doesn't count. All monsters follow him, the mobbing combo runs out after 5 s without a hit, and the priest heals meanwhile. Escape steps stay within the healer's reach where they can. The escape ends when he is back at 60 % HP and the combo has run out.
- **Taunt first** (`taunt.first`, off): Taunt one by one before Agitate (Agitate only from `agitateOver` 6). Tested 2026-11-22 at the bats: the priest's share of kills 82 -> 91 %, but ~10 % fewer kills - so off.
- **Luck catch** (v1.217.0): while a luck catcher (priest with `luckCatch`) is near, a monster on an ally that is about to die (2 hits) is spared: no Taunt, and no Agitate while one is in reach. The longer-living ones the priest absorbed are taunted back one by one, or with Agitate when none in reach is about to die and the team model allows it.
- **Protective Agitate** (party, v1.207.0): with 3+ monsters on allies, Agitate only when the team model (mobbing, fear, healing) says the warrior can hold **everything** Agitate would take (all within 320 px plus those already on him). Otherwise Taunt takes them one by one. Log: `no protective Agitate: N would be on us (...)`. Since v1.218.0 everything in reach that is not on the warrior yet must be of the farm kind (event types count): one Fire Spirit on an ally let Agitate pull three. Since v1.219.3 a foreign kind that targets an ally blocks it at any distance, not only within 320 px.
- **Clear of other kinds** (v1.219.6, `agitate.clearMargin` 80, `clearSearch` 240): before every Agitate (stream, pull point, protective) no live monster of another kind may be within 320 + 80 px, whatever its target (only ones already on the warrior don't count). Spawn boxes don't help: Fire Spirits roam into the Giant Scorpion area by themselves. With one in reach the warrior first walks to the point within 240 px that is clear of all of them and keeps the most of ours in reach (those on allies first, then the free ones), on the leash and outside failing rage zones; no such point: no Agitate (Taunt and normal combat go on). "Ours": the farm kind, in the stream also the kinds that pass the auto safety check; the protective Agitate uses the farm kind only. Log: `agitate: 1x fireroamer in reach - stepping N px clear first (...)`. Why: server rule - a monster without `rage` hits a passer-by in front of it but never chases; only Agitate, Taunt or our own hit makes it follow. The warrior deaths to Fire Spirits on 2026-11-22/23 (five, once two at a time) most likely came from Agitate.
- **Toward the spot middle** (v1.219.7, player decision, part 1; `agitate.home`, `homeSlack` 100, `homeStep` 160, `homeMinGain` 40, `homeNear` 600, `homePxPerMonster` 40): we come to most spots from one side, the priest stands there and his Absorb Sins pulls the pack outward; Agitate cast where the warrior stood pulled it further out each time (at the Giant Scorpions south into the Fire Spirits). Now the warrior standing more than 100 px from the middle of the farm kind's spawn box first walks up to 160 px to a point at least 40 px nearer the middle - the monsters on allies in reach stay in reach, clear of other kinds, on the leash - and Agitates there, so the monsters come back toward the middle. No better point: Agitate where he stands. The same point choice serves the step clear of other kinds (there the middle counts after the monsters on allies). Log: `agitate: N px from the spot middle - stepping M px toward it first (...)`. Part 2 (small steps toward the middle during the fight) is not built yet.
- **Team stats:** every fighter sends its stats to every other one each minute, not only to the leader (v1.207.0). The warrior's live check needs the priest's healing.
- **Gap step** (`agitate.gapStep`, solo and party, v1.205.0): the splash hits what stands around the *target* (explosion ÷ 3.6 px, hitbox to hitbox), there is no facing. When the splash weapons are on, 3+ monsters are on the warrior and the best target's splash misses one in range (e.g. one behind him), he steps 50 px into the **largest angle gap** between them. They all follow from one side and bunch up. At most every 4 s, from 2.5 s on when all are in range again. Never into free monsters, a failing rage zone, or (member) off the leash. Every 10 min the log shows the steps and the splash per hit.
- **Escape** (solo, v1.201.0): below 30 % HP (`escapeHp`) it runs from slower monsters, with no swings. It runs as long as something on it can still reach it: that monster's range + 100 px (`escapeMargin`), at least 250 px (`escapeClear`). Once out of reach it stands still and lets the potions work, until it is back at 60 % HP (`escapeUntilHp`). The escape also ends when nothing targets it any more, or after 45 s (`escapeMaxMs`). Each step tries 16 directions at 200, 120 and 70 px and takes the one with the most room to the nearest attacker. Cornered (no step leads away): it fights on and tries again after 5 s.
  - **Not into other dangers** (v1.213.0): a step whose point (or the middle of the way) comes within a free dangerous monster's range + `escapeKeepOff` (80 px, at least 150 px) or into another aggressive spawn's box (+ 80 px) is taken only if nothing else is left. Twice the warrior fled into the Fire Spirits ~300 px south of the Giant Scorpions and died.
- **Override:** `/agitate` switches the mode by hand (off, swords, splash, chain, splashstream).

**Sword swap** (`swordSwap`). Active only while Fiery Blades are worn:
- quick targets (≤ 5 hits) get the two best Swords of the Dead, because burn needs ~5 s and never procs on the killing hit;
- longer fights, bosses and events bring the blades back;
- the swords stay reserved in the bag.

Weapon swaps (maces, swords, and the usual weapons back when the hold ends) change both hands with one `equip_batch` call (v1.223.6).

### Priest (`classes.priest`)

| Skill | When |
|---|---|
| **Heal** | Most hurt member below 75 % (shares the attack cooldown). Self below 60 %. |
| **Party Heal** | 2+ members below 65 %, one below 35 %, or any other member below 50 % (also out of sight, from its heartbeat). |
| **Absorb Sins** | A non-tank below 35 % with monsters on it and no tank in Taunt range, while we are above 60 %. |
| **Absorb Sins: luck catch** (v1.217.0, `luckCatch`) | A monster on an ally dies within 2 hits of our strongest fighter (or the damage on its way kills it): Absorb Sins pulls everything off that ally, so the dying ones die on the priest. Drops roll with the luck of the monster's target at death, and the priest carries the luck gear. At most 5 monsters, priest above 60 %, once per 1.5 s per ally; without a tank (Taunt/Agitate) within 400 px only what his courage holds per damage type. Bosses too. Log every 10 min: `luck catch: N absorbs`. |
| **Revive** | A dead member, with an Essence of Life in the bag. |
| **Curse** | Targets needing 5+ hits. |
| **Dark Blessing** (lvl 70) | Bosses and targets needing 10+ hits. |

### Ranger (`classes.ranger`)

| Skill | When |
|---|---|
| **3-Shot** | 3 valid targets in range: attackers first, then one-shot kills, then free ones of the same kind. |
| **Hunter's Mark, Supershot** | Targets needing 3+ hits. |
| **Poison Arrow** | Same, with a Poison Sack in the bag. |

### Rogue (`classes.rogue`)

| Skill | When |
|---|---|
| **Swiftness** | On itself and party members. |
| **Assassin's Smoke** | Below 25 % HP with monsters on it; hides until 60 % HP. |
| **Quick Stab / Punch** | By the mainhand weapon type. |
| **Fan of Knives** | 3+ monsters, needs the Knife Belt. |
| **Mental Burst** | Finisher, once INT reaches 64. |
| **Poisonous Touch** | Targets needing 40+ hits. |

### Paladin and mage

- **Paladin:**
  - Mana Shield below 35 % HP;
  - self-heal below 60 %;
  - Guardian's Oath on allies below 50 %;
  - Cleansing Light;
  - Smash on targets needing 2+ hits.
- **Mage:** **Energize** (v1.225.7; costs no MP itself, hands over the MP passed and gives +80 % attack speed for 0.8 s, cooldown 4 s): MP to a member below 40 % while the mage keeps 60 %; else a 1-MP speed burst on the strongest fighting damage dealer - solo on itself, cast right before its next attack. **Reflective Shield** (level 60, 540 MP, cooldown 30 s): +20 % chance to bounce magical hits for 5 s, on whoever takes the most magical attack (at least 100), while the mage keeps 25 % MP. Mana Burst is off. **Blaster mode** (v1.224.6, `classes.mage.blaster`): the carried Blaster (great staff, blast splash, +160 MP per attack, both hands) goes on with one `equip_batch` while at least 2 other monsters stand within its blast radius (blast / 3.6 px) of the target and MP is above 50 %. Staff and book come back in one batch after 4 s without a pack, below 20 % MP, or on the way. Since v1.224.7 (`singleTarget`) it stays on all the time while it beats the best staff + book on one target (weapon power: attack × class frequency × burn, against the staff × the book's INT share; 3 % margin) - MP is kept up with potions, only below 20 % the staff comes back. The Blaster is a carried wish at +0 (`to: 0`), so the workshop never upgrades it - the player does, with a Primling per step. Weapon list: staff → Staff of the Dead → Fiery Staff (v1.226.4: with burn the Fiery Staff is the better one for the mage). Next to a two-hander the offhand counts as taken (v1.225.4): no book wishes, no book put on, and the merchant gets an "_twohand" marker instead of an empty offhand - it had brought book after book. The best book stays in the mage's bag for staff + book (v1.225.5); spare books go back to the merchant. **Blaster aim** (v1.225.6, `blaster.aim`): with the Blaster in hand it shoots the monster of the target's kind in range that has the most others within the blast radius (not another player's, never the Giga Crab). **Splash safety** (v1.225.8): a Blaster shot whose blast would hit a free boss or a monster the mage can't kite (faster, longer reach, abilities) is never fired - another safe target of the same kind, else staff + book for 6 s (`blockMs`); without a staff in the bag the shot waits. The blast had pulled a roaming Phoenix at the Crocs. **Pull limit** (v1.225.9): the monsters a blast would hit (free ones within its radius) plus those already on the mage must stay within his courage per damage type (`fearMax` 0) and pass the solo pack check - like the warrior's Lolipops. The mage had died terrified at the Squigs with 5-6 on him. **Bosses and the staff line** (v1.226.0): against a boss the mage always fights with staff + book, whatever is stronger. Weapon list: staff → Staff of the Dead → Fiery Staff (v1.226.4: with burn the Fiery Staff is the better one for the mage). While the carried Blaster is in hand the mage reports its single-target loadout (best other one-hander and book in the bag, or an empty hand) and keeps that staff and book, so the merchant still builds and delivers the staff line. No Blaster during a boss event or with a boss within 400 px; putting it on takes the book off first - the game refuses a two-hander next to an offhand (v1.226.1). A mode's weapon (splash or carried) is never remembered as the usual weapon, and a refused restore drops the memory - the gear module had kept putting the Blaster back during a Phoenix fight. **Team Magiport** (v1.236.0, `classes.mage.magiport`, player decision 2026-11-24; replaces the boss magiport of v1.228 and the travel magiport of v1.235): one rule for every team goal, whoever leads. Once the mage is at the goal itself - a farm spot or Daisy as the members' "there" (`party.atGoal`), a boss in its sight within `bossRange` (800) px for `graceMs` (4 s, map changes and new entities settle first) - it pulls every team fighter farther than `minDist` (600) px or on another map: the tank first, then in the team's order, 900 MP each while 30 % of its MP stays; up to 3 tries per member and goal, 8 s apart. A member seen within 600 px at the goal is not pulled again for that goal (e.g. a potion trip later). Never in the cave, under `/manual`, for a join event or during a boss search (ours or the team's) - a find becomes the leader's boss goal, and the mage pulls from there. The journal (tag `party`) says why it does not pull someone on another map ("not at … yet", "the Phoenix not in my sight yet", tries, low MP). The members accept (`on_magiport` in main.js → `events.acceptMagiport`) from a team fighter in the party while the team fights a boss, or for a team goal they have not been at yet; declined in the cave, under `/manual`, during a boss search and for a goal they have been at - with a log line. After an accepted port a path walk planned from the old place is dropped (0.4 s and 1.5 s later) - the next tick plans from the landing point (v1.235.9; priest and warrior had walked on to their old point first). A runner that just found its boss treats it as the team's event and waits at it until the leader's event arrives (at most 60 s, `heldFind`, v1.235.9) - the mage had blinked back towards the priest after reporting Dracul. **Blink on routes** (v1.234.0, `classes.mage.blinkTravel`, player decision 2026-11-24): Blink has no range limit on the server (any point of the same map; test: 980 px, landed 35 px off). On a path walk the mage jumps to the farthest step of its plan on the current map - the next door or the goal - when it is at least `minDist` (400) px away, its MP stays above `keepMp` (40 %) after the 1,600-MP cast (Magiport needs 900 per member) and nothing attacks it; never under the manual rules (cave, `/manual`). The steps up to there are dropped from the plan, the landing point stays, so the walk ends exactly there; a refused blink waits 10 s. Once landed (v1.235.13) the walk goes on with the farthest step of this map reachable in a straight line - the server lands us on the nearest safe spot, sometimes behind an edge, and the game replanned ("Lost the path..." in the arena). Blink never jumps into a farm spot (the team goal's spot, else the farm target): the farthest step outside it.

## 24. Merchant: the main loop

The merchant ticks every second.

**Survival.** It drinks an HP potion below 50 % HP and an MP potion below 20 % MP, then casts Merchant's Luck.

**Merchant's Luck** (`merchantRole.mluck`) goes to:
- itself and our fighters, renewed below 30 min;
- other players nearby (2 % chance of a copy of their loot); another merchant's stronger luck is left alone.

**Work order** (the first item that holds the merchant ends the round):

1. A running **Ponty round** ([§27](#27-ponty-rounds-over-all-servers)).
2. A running **trade trip** ([§26](#26-market-stand-and-player-trades)).
3. **Bag nearly full:** go home and sell first.
4. **Pickup requests:**
   - It answers `coming`, follows the fighter to its newest position (re-routing beyond 150 px, giving up after 4 min), and hands over the requested items: potions, class items, a Tracktrix for a fighter without one, and finished gear.
   - It casts Merchant's Luck on the fighter, then waits 10 s for loot and gold.
5. **Home:** the stand spot on main (`merchantRole.stand.home`). Every NPC within 390 px is used from there without walking.
6. **Chores** (at most every 30 s), in this order:
   1. sell junk;
   2. bank;
   3. one unit of **workshop** work ([§28](#28-workshop-wishes-and-upgrades));
   4. restock potions: 300 per fighter and type, only while gold ≥ 100k, never below the gold reserve (20 %, max 1M).
7. **Fishing** (`merchantRole.gather.fishing`): at the main pier whenever the cooldown allows (Rugged pieces).
8. **Every 10 min:** the workshop report.

## 25. Selling and banking

**Selling to NPCs.** Rules are checked in this order:
- **Never sold:**
  - shiny, locked, wished or earmarked items;
  - a piece that fills a fighter's empty slot;
  - level-1+ copies of gear-goal items;
  - Phoenix and event items.
- **Sold:**
  - shop armor in a stat nobody builds any more;
  - outgrown gear-goal copies;
  - spare Rings of Small Joys;
  - finished Rugged copies nobody needs;
  - `merchantRole.sellList` entries up to their `maxLevel`;
  - outgrown potion sizes;
  - with `sellBuyable`, anything an NPC sells, at +0 (except consumables and scrolls).
- **Wanderer's pieces** are sold once the priest's Wanderer goals are done (v1.224.0: only the priest runs the set).

**Banking.**
- **When:** fewer than 6 free bag slots (`bank.whenFreeBelow`), or 30 min since the last visit. Before every pickup too, while fewer than 12 slots are free (`bank.beforePickupFree`, v1.217.8: store only, workshop copies included) - back-to-back pickups (Ponty-round prep) used to fail with `send_no_space`. Below 15 free slots (`bank.stockFreeBelow`, v1.223.3) the workshop's idle stock (copies waiting for a compound or upgrade) is banked too; the workshop takes it out again when it works on it. The workshop takes copies out of the bank only while 2 slots stay free (`workshop.bagReserve`, 8 until v1.223.3 - the bank-before-pickup rule covers pickups); a job stopped by a full bag tries again after 10 min, not an hour.
- **What stays in the bag:** sellable items, finished gear-goal copies, potions, `bank.keep` items (scrolls, stand, rod, Tracktrix …), copies waiting to be dismantled, and reserved items unless the bag is tight.
- **Junk:** after a visit, sellable junk is taken back out of the bank and sold.
- **New bank packs are never bought.**

## 26. Market stand and player trades

**Stand** (`merchantRole.stand`, `config.market`). With a stand in the bag, the merchant keeps it open at home. It keeps the stand open for Merrit's hourly Market Parcels.
- **Buy orders** (`market.buy`) cover what is missing up to `want` (bag + bank counted). Examples: Bee Wings, Crab Claws, Essence of Fire, Lolipop Maces, crossbow.
- **Wish orders** (`market.wishOrders`): one copy of each wished item at 1.2 × our own cost, at most 20 % of the gear pot and 8 orders. A fill is booked only when the item really arrives.
- **Sell orders** (`market.sell`): Leather, Snake Fangs. Monster Tokens are no longer sold (v1.215.1): they are saved for the Monster Hunter armor sets at Daisy (53 per class). Fun Tokens neither (v1.215.2, player decision).

**Trade trips** (`market.sellTo`, every 20 min). The merchant scans every stand on every server:
- **Sell:** into the best buy order at `minPrice` or more for anything above `keep`:
  - Vitality Earrings +0 500k+ / +2 8M+.
- **Buy** (`buyFromPlayers`): what Ponty would buy, under the same price rules.
- **Trip:** take the items out of the bank → hop to that server → walk to the stand and trade → hop home.
  - The game limits trades to the buyer's gold; the merchant halves the quantity until it fits.
  - A failed trip blocks that offer for 30 min.
- **Logs:** every trade goes to `bot_trade_log`.

## 27. Ponty rounds over all servers

`merchantRole.pontyRound`: every third full hour local time (`everyHours: 3` since v1.228.4 - hourly rounds mostly bought nothing and every hop ends a Lost and Found access; in minutes 0–29), or on `/ponty`.

1. **Prep:** call every fighter for a pickup and serve them; then sell, bank and leave.
2. **Travel:** hop to each server in `servers` (EU, US, ASIA, PvP; the home server is skipped). On each server:
   - bank if the bag is nearly full;
   - visit Ponty and buy what the rules allow ([§28](#28-workshop-wishes-and-upgrades));
   - with a full bag: bank and visit again (up to 2 times).
3. **Home:** log `Ponty round done in N min: …` and append the round to `bot_ponty_round_log`.

**Home server** = the server in the leader's heartbeat. A merchant restarted elsewhere asks to hop home.

**Leader needed** (v1.224.1): the leader's client makes the hops, so a round starts only while the leader's heartbeat is under 2 min old (`leaderFreshMs`). Without it the slot stays due for the first half hour. A leader that goes offline during the prep drops the round. Before that, a merchant running alone hung on its first hop.

Ponty is also checked at home every 20 min (`market.ponty.everyMs`).

## 28. Workshop: wishes and upgrades

The workshop is the merchant's brain for gear. It does **one unit of work per chores round**.

**Order inside one workshop round:**
1. bookkeeping (income, drop reports, value report);
2. earmark ready copies and ping fighters with something waiting;
3. own wishes (stand, rod, pickaxe);
4. dismantling;
5. a Tracktrix for each fighter;
6. a Ponty check;
7. earmarks for empty slots, better weapons and material goals;
8. parallel jobs: Rugged spares, material goals, compounding when the bank is nearly full;
9. **no open wishes:** compounding → better weapons → Rugged armor → **gear goals** → exchanges;
10. **open wishes:** the best wish by value. Every 3 min the step-9 list gets a turn anyway, and so does a bonus wish such as a Wanderer's piece.

**Wish order** (`valueReport.orderWishes`):
1. wishes that need no farming, by gain per gold;
2. wishes that need farming, by gain per hour;
3. wishes without gain.

A delivered wish is not fulfilled again for 6 h (rings and earrings excepted).

**Building a copy** (`develop`):
- **Base:** the best lower copy in the bag or bank, else bought from an NPC, crafted, taken from a box, bought with tokens, or reported as a drop shortage.
- **Upgrading:** step by step at the upgrade NPC.
  - **Stat:** a wished stat scroll is applied before the step into the next grade, while it is cheaper.
  - **Scroll choice** (`workshop.scrollChoice`): per step, the scroll with the lowest expected gold, (scroll + (1 − chance) × value of the copy) / chance, with the server's chance formulas.
  - **No risk floors** (`workshop.risk` all 0): every step is tried; a failure only costs the copy.
  - **Mass Production** is cast first.

**Deliveries.**
- Finished items are **earmarked** for their fighter (`workshop_earmarks`, kept 12 h).
- The fighter is pinged once no other open wish can still be finished, or after 10 min.
- Every wish gets the **best fitting copy** (the highest level that meets it).
- The old piece comes back on the next pickup and becomes the next base.

**Ponty and player-stand purchases.** Offers are checked highest level first:
- **Wishes and gear goals:** a copy above what we hold, or a **base**. For upgradeable items, copies are bought until the reach chances of the copies we hold add up to one finished piece (`baseTargetPieces` 1, at most `maxBaseCopies` 20). A +6 counts its ~25 %, a +0 its ~5 %. Worn copies count as finished, never as bases.
- **Finds:** pieces nobody wished, rated by gain per gold against our best own upgrade. The best one worth it is bought (`buyFinds`), gets the main-stat scroll and is earmarked.
- **Material sources:** Of-the-Dead +0 for Bones, Short Swords as bases ([§30](#30-workshop-weapons-and-material-goals)).
- **Price rules:** at most 1.2 × our own cost (`maxShareOfOwn`) and at most 20 % of the gear pot (`maxShareOfPot`).
- **Log:** every purchase goes to `bot_ponty_bought`.

## 29. Workshop: gear goals and stages

`workshop.gearGoals` pushes what the fighters wear to `upTo` (+8) when there is time.

- **Slots:** helmet, chest, pants, shoes, gloves, mainhand, and the offhand when it holds a weapon.
- **Team-wide stages** (`stages: [7, 8]`): everyone's shop gear reaches +7 before anyone goes to +8.
- **Per-piece caps** (`capBy`, v1.219.0): once the whole team is through the stages, a listed worn shop piece goes on to its own cap - the ranger's coat to +9.
- **Shop pieces** are re-buyable, so every attempt is made. Finished copies get the fighter's main-stat scroll and are delivered; the old piece comes back as a base.
- **Shop weapon goal:** a fighter wearing a drop weapon gets its class's shop weapon built to +8 if that would beat the drop weapon.
- **Off-plan armor** (v1.206.0). An armor slot that is **empty** or holds a piece **outside the class's gear plan** gets the plan's next step. The plan here means: shop piece, Wanderer's equivalents for the priest, wish chains with their alternatives, and found items.
  - A wish chain with `replace` (Rugged for tanks, Wanderer's for the priest) already does this.
  - Otherwise the shop piece is built at the current stage with the main stat. A fighter whose shop armor is done (all at the last stage) uses the team stage, or the last one (v1.210.8; before, the ranger with all pieces at +8 got nothing for his chest). Only if it is at least as good as the worn piece in main stat and in armor + resistance, and better in one.
  - Log: `VizRng chest: tshirt1 +3 is outside the gear plan - building coat +8 dex`.
  - Why: the ranger's lucky T-Shirt +3 (9 DEX, nothing else) kept the gear goals from ever building his Coat +8 (12 DEX, 12 armor, 10 resistance).
- **Wanderer's set** (`gearPlan.equivalent`, `gearPlan.parallel: "opener"` = the priest only since v1.224.0):
  - A Wanderer's piece is built at least to the level of the worn shop piece of its slot (or to the stage) and replaces it. Example: the priest's helmet +7 → Wanderer's Cap +7 (INT).
  - From then on it is upgraded instead of the shop piece.
  - Pieces are crafted from stock only when every ingredient is in the bank (`craftFromStock`).
  - The other classes stay on shop armor, the tanks on the Rugged set.
- **Stat scrolls:** a copy whose stat another fighter wishes for is never re-scrolled.
- **Pot empty:** `gear goals wait for income …`, retry in 15 min.
- **Stopped jobs** (no copies, a missing ingredient, too risky) wait an hour (`giveUpForMs`), lacking gold or bag space 10 min. Since v1.224.3 the locks survive a restart (`workshop_blocks:<merchant>`).
- **Rhythm** (v1.224.4, `merchantRole.workshopFastMs`): a round that did something (bag or bank changed) is followed after 3 s; a round that only found locked jobs tries the next one at once (up to 8 in a row); the 30 s chore interval only when there is nothing to do. The merchant still goes back to its stand after every round.
- **Online fighters only** (v1.225.0, `workshop.onlineMs` 10 min): wishes, gear and material goals, weapon plans, Ponty buys and deliveries serve only fighters whose heartbeat is fresh - nothing is built in the background for characters that are not played. What is reserved or never sold still counts every fighter.
- **Main stat on every delivery** (v1.226.2, `workshop.statOnDelivery`): an item with a stat slot goes to a fighter only with that fighter's main stat - none or a wrong one gets the stat scroll first; up to 100k of scrolls need no pot. Until then the item is not handed over.

## 30. Workshop: weapons and material goals

**Weapon lists** (`gearPlan.weapons`, worst → best):

| Class | List |
|---|---|
| warrior | Blade → Sword of the Dead → Fiery Blade |
| priest | Staff → Fiery Staff → Staff of the Dead |
| ranger | Bow → Firebow |
| rogue | Stinger → Dagger of the Dead |
| mage | Staff → Staff of the Dead → Fiery Staff (burn counts for the mage, v1.226.4) |

**Planner.** The planner walks each list **from the back**. It takes the first item it can work on that, at most at its cap (`weaponCaps` 7), beats the fighter's weaker weapon hand by 3 % (`betterWeapons.margin`). Shop weapons are left to the gear goals; fire and Dead weapons to the material goals.

**Shared materials** (v1.219.0): a recipe that is no weapon waits while the material's weapon goals are open (essence of fire: fire weapons before Fiery Gloves and Ember Seals); `workshop.materialOrder` sets who gets a material first (essence of ether: Thundergrips, then Moonshard, then Wind Belt). A missing ingredient at a level (hunter gloves +6, INT ring +2) is built first when we have a lower copy, a shop or a token offer. `workshop.dailyTries` caps upgrade tries per day (Dracul's Attire +8: 3). The Rugged spare copies (`boxArmor.upTo`) go to +8.

**Material goals** (`materialGoals`). The weapons made from a dismantled material:

| Material | Items | Pot | Bases |
|---|---|---|---|
| Essence of Fire (`essenceoffire`) | Fiery Blade, Fiery Staff, Firebow … (+ shop weapon + 20k at Leo) | ladder (borrows from the gear pot while gear goals are idle) | essence only |
| Bones (`mbones`) | Of-the-Dead weapons (+ base + fee) | gear pot | Ponty / player copies (`buyCopies`) |

- **Goals:** every material item on a fighter's list that beats the worn weapon at the goal level (`upTo` 7).
- **Priority** = place from the back of the list; the lowest number goes first. The others wait: nothing is crafted for them, and their +0 copies are dismantled.
  - Exception: an item not on `dismantle.names` (the Sword of the Dead) is still upgraded when held.
  - Buying is never held back.
- **Step by step** (`deliver: "better"`):
  - Upgrades aim at the first level at which a copy beats the weaker worn weapon.
  - That copy is delivered, the replaced weapon comes back as the next base, and the next run aims one step higher, up to +7.
  - Example: blade +3 worn → Fiery Blade +3 → … → +7.
- **Delivery:** per fighter, the **strongest held copy over all materials** that beats the weaker hand goes out. A Sword of the Dead +6 wins over a Fiery Blade +3. One weapon at a time, 10 min apart.
- **Buying for Bones:**
  - Mace, Staff, Bow and Dagger of the Dead +0 up to 300k (`sources`) are bought to dismantle into Bones.
  - Short Swords up to 150k (`rareBases`) are bought as Sword of the Dead bases.
  - The Spear and the Hand of the Dead are kept and never bought for Bones.

## 31. Workshop: compounding, exchanges, dismantling

- **Compounding** (`workshop.compound`):
  - Wished rings, earrings, amulets, belts and books are built from three copies per level.
  - Without wishes, spare copies are combined up to +3 (`autoUpTo`), keeping `keep` copies (2 DEX belts +2).
  - Tidy-up (v1.224.2): an auto-compound step costing at most `tidyMaxCost` (50k) never waits for a pot (jewellery up to +2 with the 6.4k scroll). The +2 → +3 step (240k scroll) still pays from the gear pot.
  - Vitality Earrings are held at +0 while buyers pay 500k+, and compounded no higher than +2.
- **Exchanges** (`workshop.exchange`):
  - Leather is exchanged, 10 at a time, while 8+ bag slots are free. Seashells (off in v1.227.4, back in v1.229.0) only while a stat elixir of the team is short - see Elixirs in §21; 40 always stay for Loaded Dice.
  - Gems, Market Parcels and (since v1.224.5) Armor Boxes are held (`hold`): stockpiled for Band of Fury and Heavy armor later.
  - Without the hold, Armor Boxes open only when a wished Rugged piece can come out (3 at a time, bank with 10+ free slots).
- **Rugged spares** (`boxArmor`): while a Rugged piece is wished, spare copies are upgraded towards +8. Once a piece is held at +8, or (v1.224.0) nobody wears or wishes it, its +0 copies are sold.
- **Dismantling** (`dismantle`):
  - +0 copies on `dismantle.names` are dismantled at Leo into their material: Fiery weapons → Essence of Fire; Mace, Bow, Dagger and Staff of the Dead → Bones.
  - Never dismantled: worn, wished, earmarked, locked or protected copies, or copies a material goal needs.
  - The Sword of the Dead is never dismantled: its Short Sword base only comes from weapon boxes.

## 32. Money: pots, budgets and prices

**Income.** The merchant books every gold change in 10-min buckets over 24 h (`workshop_income:<merchant>`): fighter handovers, sales, spending. Consumables (potions, buy-order materials) count against income.

| Pot | Fed by | Pays for |
|---|---|---|
| **Gear pot** (`goals`) | 70 % of the net income of 24 h (`gearGoals.budget.incomeShare`) − gear spending | wishes, gear goals, stat scrolls, Ponty and player purchases, wish orders, Bones goals, Rugged spares |
| **Ladder pot** | 25 % (`bruteForce.incomeShare`) | essence goals (borrows from the gear pot while gear goals are idle) |

- **Floor:** the workshop never spends below `workshop.keepGold` (20 % of the highest gold of 24 h, at most 5M) or the merchant's gold reserve.
- **Extra gold:** `budget.extra: { amount, until }` adds gold to a pot until a time.
- **Fresh start:** `budget.resetAt` makes every pot ignore everything before that time (fresh start for 24 h).
- **Per-wish cap:** `budgetPerWish` (1M shop, 4M rare, 8M for each Wanderer's piece). It resets on every merchant restart.
- **Waiting for income:** a pot short of gold pauses that job for 10–15 min.

**Own cost** (`ownCost`) = expected gold to build an item ourselves:
- scrolls, failures included;
- base or craft fees and craft ingredients;
- expected drop copies × hours per copy × the team gold per hour we lose on the drop spot.

Drops slower than 1000 h per copy have an unknown cost. Purchases and wish orders are priced against `ownCost`.

**Value report** (every 15 min, `[value]`):
- each fighter's XP per hour;
- **farm gold per hour** (fighter handovers only; trade sales are left out);
- the top wishes by gain per hour.

The leader uses it to weigh drop spots ([§19](#19-drop-farming)).

## 33. Watchdog and server hops

**Heartbeat.** Every bot writes `bot_beat:<name>` (`{at, server, hp, rip}`).

**Watchdog** (`watchdog`). The client that hosts a bot window restarts it when its heartbeat is 2 min old or the window is gone.
- At most one restart per 10 min and 3 per hour; then it gives up with a red log.
- The leader's own window is not covered.
- A member stopped on purpose comes back too.

**Server hops.**
- `change_server` is never used from code: from a bot window it opened a full game.
- Instead the merchant writes a hop request (`bot_hop_request:<merchant>`). The client hosting the merchant's window re-creates it on the other server (hop watcher in `main.js`).
- A merchant silent for 6 min on a round or trip away from home is brought home.

## 34. Rules the bot never breaks

- Never withdraws bank gold, never buys bank packs.
- Never sells Phoenix or event items, shiny or locked items, or anything wished or earmarked.
- Never dismantles the Sword of the Dead.
- Never spends below the gold floors; every purchase stays within its pot and price rules.
- Never uses `change_server` from code, and never runs the archive characters of the main account.
- Never trusts CODE messages from characters outside the team.
- Never pulls a monster the safety checks reject; never fights monsters other players fight (cooperative bosses excepted).

## 35. Inactive or surprising settings

| Setting | State |
|---|---|
| `workshop.bruteForce` | Only its `incomeShare` is left: the ladder pot that pays the material goals. The weapon ladder and the stock upgrades were removed in v1.212.0 (all their items are on `dismantle.names`). |
| `workshop.grace` | Off; all risk floors are 0, so every step is tried. |
| `betterWeapons.names` | Only used for classes without a weapon list (all four of ours have one). |
| `gearGoals.budget.extra`, `bruteForce.extra`, `grace.extra` | None since 2026-11-24 00:00 UTC: every pot started from 0 again without an extra (`budget.resetAt`, v1.229.2, player decision). Before: a reset at 2026-11-23 18:38 UTC with 10M each (v1.226.3). |
| `classes.warrior.dash` | Off. |
| `events.farmBosses` | Empty: no nonstop boss hunting. |
| `cavalry.targets` | Empty: no nuking for loot. |
| `hunts.enabled` | Off during the warrior's solo phase. |
| `combat.dangerShare` | Not in config; the code default (1) applies. |
| `party.leash` | No follow or kite leash any more. Read only by the warrior's Agitate (gap steps, stream walks, catching up) and by the rage-zone check: a member with the leader within 300 px judges a zone with the team model ([§11](#11-safety-checks)). |
| Fixed thresholds | Priest Curse (5 hits), paladin Smash (2 hits) and Guardian's Oath (own HP > 50 %) are in the code, not the config. |
| Market buy orders | A `market.buy` order needs gold ≥ one unit's price, not the whole quantity. |
| Auto compounding | Does not check wishes: any compound item below +3 with 3 spare copies (beyond `compound.keep`, not Vitality Earrings held for buyers) is combined. |
