# Adventure Land Bot (v1)

One bot for a whole Adventure Land team: up to three fighters and one merchant, all running the same code.
The fighters farm, hunt bosses and level up; the merchant supplies them, sells, banks, trades with other players and upgrades their gear.

> **Version:** `1.216.0` (`bot/config.js` → `version`) · **Teams:** `Dmpx…` (main account) and `Viz…` (second account) · **Code:** `bot/` → in-game CODE slots 20–39

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
| `/ponty` or `/ponti` | any of our clients | The merchant starts a Ponty round on its next check (shared storage `dmpx_ponty_force`, dropped after 10 min). Started in minutes 0–29 of an hour, it counts as that hour's round. |
| `/phoenix` | leader | Search the Phoenix now and lift its 3 h pause. |
| `/jr`, `/greenjr`, `/mvampire` | leader | The same for Jr., Green Jr. and Dracul. In the party phase a runner searches them; in solo it only lifts the pause. |
| `/search <boss>` | leader | The same for any watched boss (default `phoenix`). Aliases: `phönix`, `phonix` → phoenix · `vampire`, `vampir`, `dracul` → mvampire · `gjr` → greenjr. |
| `/agitate off\|swords\|splash\|chain\|splashstream\|config` | warrior | The warrior's Agitate mode, kept across restarts (`agitate_mode:<name>`). `config` goes back to the config's choice. Solo only: in a party the automatic decision applies. |
| `/dps` | leader or solo fighter | Print the damage meter now ([§16](#16-party-play)). |
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
2. **The merchant** only when it is idle: no trade trip, no Ponty round, empty upgrade queue. Check that `get("dmpx_trade_trip:<merchant>")` and `get("dmpx_ponty_round:<merchant>")` are `null` and `character.q` is empty.

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
| Runner for Dracul, Jr., Green Jr. | `events.runner.enabled`, `runner.bosses` (interval per boss) |
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
| Ponty rounds over all servers | `merchantRole.pontyRound.enabled`, `everyHours` (1) |
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

| Key | Holds | Clearing it… |
|---|---|---|
| `dmpx_ponty_round:<merchant>` | Running Ponty round | aborts a stuck round |
| `dmpx_trade_trip:<merchant>` | Running trade trip | aborts a stuck trip |
| `dmpx_ponty_force` | `/ponty` request | cancels the request |
| `dmpx_hop_request:<merchant>` | Server hop request | — |
| `dmpx_boss_pause:<leader>` | Boss pauses after deaths | lifts them (better: `/phoenix` …) |
| `dmpx_boss_search:<leader>` | Next search time per boss | makes every boss due |
| `dmpx_farm_experience:<name>` | Proven spots, 1 h death blocks | removes death blocks |
| `dmpx_crowded:<name>` | Crowded spots and their doubling | frees crowded spots |
| `dmpx_strong_spots:<name>` | Spots waiting for the Cavalry | — |
| `dmpx_cavalry_next` | Next Cavalry call (account-wide) | — |
| `agitate_mode:<warrior>` | `/agitate` override | back to config |
| `agitate_stats:<warrior>` | Learned splash, scale and denies per monster | relearns from scratch |
| `workshop_earmarks:<merchant>` | Copies reserved for fighters | releases them |
| `workshop_delivered:<merchant>` | Delivered wishes (6 h pause) | allows redelivery now |
| `workshop_worn:<merchant>` | What each fighter wears | refilled on the next wishes |
| `workshop_wishes:<merchant>` | Each fighter's wish list | refilled every 5 min |
| `workshop_income:<merchant>` | 24 h income and spending (all pots) | **resets every pot** |
| `dmpx_beat:<name>` | Heartbeat `{at, server, hp, rip}` | — |
| `dmpx_journal:<name>` | Last 400 decision lines with timestamps | — |
| `dmpx_ponty_bought` | Last 200 purchases (Ponty, orders, players) | — |
| `dmpx_ponty_round_log` | Last 50 Ponty rounds | — |
| `dmpx_trade_log` | Last 100 player trades | — |
| `dmpx_value_report` | Last value report | — |

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

The lines tagged `target`, `drops`, `hunt`, `event`, `party`, `cavalry` and `dps` also go into the **decision journal** (`dmpx_journal:<name>`, last 400 lines).

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

**Messages between characters** (`comms.js`): `send_cm` with the envelope `{ p: "dmpx1", t: type, d: payload }`. A message is accepted only from a character of our own team (`config.characters`) and only for a known type. Other players' messages are ignored.

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

The fighter loop runs every `tickMs` (250 ms). Each pass writes the heartbeat `dmpx_beat:<name>`. Order of one tick:

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
- `travel.leaveVia` (v1.215.0) does the same on the way out: every path walk leaving `spookytown` for another map (travel, following the leader, pickups, bank and potion walks) goes to `halloween` first. Before, the way back went spookytown -> level2 -> level1 past the level-20 Vampire Rats. A direct neighbour (`level2`) and goals whose map can't be told are walked to as asked.
- A failed route marks its point bad for 60 s; the bot then walks by monster name.
- The Town teleport (`movement.useTown`) is used only farther than 600 px from the map's center, never while monsters attack us, and never while following a leader.
- **Pass-through:** the leader or a solo fighter on its way to the farm spot leaves slower attackers of other kinds behind (HP ≥ 50 %, not within 400 px of the spot, never bosses). Any fighter stuck for 60 s fighting a non-farm kind walks out towards the farm target (`combat.passThrough`).

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
- An objection on the current spot must last `objectionGraceMs` (5 min) before the team leaves. A death counts at once.

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
  - **aggressive kinds** (aggro and rage ≥ 0.3, or a rage zone): all free ones come at once, so the pack check runs with the strongest of them (team model as leader, own hits and sustain solo). There is no "harmless" shortcut, because 20 single hits say nothing about 3 booboos at 1.2 hits/s each;
  - **passive kinds:** at least one of them passes the live check, and the largest group of free ones standing close (chained within `groupGap` 60 px, edge to edge) passes the pack check as one pull (v1.213.0). One at a time each X-scorpion passed ("6 of 6 fine", levels 10-11); the warrior's splash pulled 6 and he died.
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
- All fighters' hits count together (`dmpx_hit_factor:<name>`). Above 400 hits the sums are halved, so old hits fade.
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
- **The whole kind:** when every spot of a kind fails, or the grown monsters in sight all fail the safety check, the kind is blocked until the Cavalry is ready to reset it ([§15](#15-cavalry-tracktrix)) (`dmpx_strong_spots`, log `X too strong here (...)`), and a hunt on it is skipped ("every X spot taken or too strong"). Without the Cavalry the kind is skipped like a crowded spot instead.

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
- **Avoid:** points near free monsters (120 px).
- **Bosses:** kiting stays within 280 px of the boss's spawn area.
- **Cornered:** the fighter looks for an escape point; if there is none, it stands and fights.

A single attacker that can't be kited switches kiting off. The warrior (range 38) never kites. Check a monster's `charge` in `G.monsters` before tuning: the Phoenix charges at 65, faster than a ranger.

**Spacing** (party, `party.spacing`). Ranged non-tanks keep out of the monsters' melee reach (their range + 50) while a tank is near.

**Too-strong spots:** see [§12](#12-crowded-taken-and-too-strong-spots).

## 15. Cavalry (Tracktrix)

The Tracktrix (`tracker`, kept in every fighter's bag) calls the Cavalry. It is strong while the account's highest level is below 80.

**Emergency** (`cavalry.emergencyHpBelow` 0.35). Below 35 % HP with a level-3+ monster on us, the Cavalry is called at once.

**Reset of a grown spot** (`cavalry.reset`):
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

The cooldown is shared by the account (`dmpx_cavalry_next`, at least 10 min).

## 16. Party play

**Leader.**
- Invites missing members every 10 s.
- Broadcasts its position, farm target, target, route end and event every 2 s.

**Members.**
- Accept invites only from the leader and leave any other party.
- **Follow:** with `party.goToDest`, members walk to the leader's route end themselves.
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

`server.status` tells which events are live; `events.observe` logs every change (`[event] live now: …`). `events.policy` decides per event (`"always"` / `"never"`). An event counts only when every fighter has reached `events.minLevel` and the boss check (below) says the team can win.

**Event kinds.**
- **Join events** (Goo Brawl, Graveyard): every fighter joins and takes its own nearest wave monster.
- **World bosses with a position** (Snowman): the team travels there and fights.
- **Roaming bosses:**
  - `events.search` (Phoenix): the team searches all spawn areas every `searchEveryMs` (20 min).
  - `events.engage` (Dracul, Jr., Green Jr.): fought whenever met, and searched by a runner.

**Boss check** (`events.boss`). From the team's real stats:
- every fighter survives 6 hits;
- the damage on the tank stays below the priest's healing × 1.5 (solo: 150 HP/s sustain);
- a fighter that can kite the boss counts as taking no damage;
- `maxFightMinutes: null` sets no kill-time limit.

A visible boss is checked with its live stats (bosses grow).

**Search** (Phoenix).
- The leader walks every spawn area and looks around 4 s at each. Any watched boss in sight ends the search.
- After a kill, a slow boss (respawn > 200 s) is searched again at kill + respawn × 0.72. The Phoenix respawns after ~32 s at a random spot.
- **Parallel search** (party, `splitSearch`): the leader splits the areas between the fighters. A finder reports, the team meets at the finder, and the leader waits at most 4 min for the others' areas.

**Runner** (`events.runner`, party only).
- **Who:** the fastest ranged fighter (never the leader or a healer). It searches Dracul (every 20 min), Jr. and Green Jr. (every 60 min) alone while the others farm on.
- **On a find:** the runner reports it and the team comes. Like the Phoenix, the runner opens the fight alone when its solo boss check (kiting included) passes; otherwise it holds outside the boss's spawn box until the team is there (`holdFor` is empty since v1.209.2).
- **Nonstop:** `farmBosses` would make the runner hunt a boss nonstop (off).

**Pause after a death.** A fighter dying within 600 px of a boss pauses that boss for 3 h (`pauseAfterDeathMs`). A death elsewhere does not. `/phoenix` (etc.) lifts the pause.

During a boss fight Daisy trips are aborted, and the fighter fights the event's boss without a leash.

## 18. Monster Hunts

`hunts.enabled` (off in solo). A hunt is taken only when every fighter has reached level 20 (`minLevel`) and all of these hold:
- it is on this server with kills left and more than 2 min left;
- it is safe for the team (the same check as farm spots; `allow` / `deny` override);
- the monster is among the team's **top 5 XP spots** (`xpTop`);
- the remaining kills fit in the time left (team speed from the guide).

The hunt expiring first wins.

**Daisy trips:**
- A finished hunt is turned in at once (Monster Token).
- New hunts are fetched at most every 10 min, when someone has none and nothing is huntable.
- The leader waits up to 45 s at Daisy for the members.

## 19. Drop farming

Items that can't be bought come before XP when they are worth more (`drops`).

1. **What is missing.** The merchant reports, every 5 min, the wished items it lacks copies for, plus `drops.want` (50 Armor Boxes).
2. **Routes.** The leader asks its guide and the game's drop tables where each item drops. Only team-safe routes that take at most `maxHoursPerCopy` (4 h) per copy are kept. Bosses are excluded.
3. **By value** (`byValue`). The leader compares the XP spot with each drop spot: XP value plus gear value (the wish's gain per hour). A drop spot must be worth `valueSwitch` (1.2 ×) the current choice to switch.
   - Log: `[drops] value: XP spot X%/h vs <monster> Y%/h -> …`.
4. **Spot gold** (`spotGold`). Every fighter measures its loot gold per farm target over 3 h, but only while the whole team farms together. The merchant prices buy orders from these numbers ([§32](#32-money-pots-budgets-and-prices)).

## 20. Fighter gear: wishes and equipping

**Wishes.** Every 5 min, and at once after a gear change, each fighter sends the merchant:
- **its wish list:**
  - the progression guide's requests (up to 12);
  - the class chains from `gearPlan.wishes`;
- what it wears, its class, its XP value, and whether it carries a Tracktrix.

**Class chains** (`gearPlan.wishes`, `{stat}` = the class's main stat):

| Slot | Chain | For |
|---|---|---|
| cape | Cape +0 (40 Leather) | all |
| shoes | Winged Boots +7 | all |
| offhand | Quiver +0 → +7 → +8 | ranger |
| orb | orbg +0 → +1 → Orb of {stat} (alt: Loaded Die) | all |
| ring / earring / amulet | {stat} piece +2 → +4 | all |
| belt | {stat} belt +0 → +4 (alts: Wind Belt, Knife Belt) | all |
| helmet, gloves, pants, chest, shoes | Rugged set +7 | tanks |
| chest, pants, gloves, shoes | Wanderer's pieces +8 (shoes alt: Winged Boots) | priest (chest opener) |
| carried | 2 orange Lolipop Maces +7 (green ones stand in) | warrior |

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
7. take off off-stat jewelry and `gear.noEquip` items (Hand of Midas, Heavy Underarmor, Dracul's Attire).

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
- 15 min have passed since the last visit;
- or `/pickup` is typed.

While the merchant walks over, the fighter keeps farming and sends its position every 5 s.

**Handover.** When the merchant is within 250 px, the fighter stops and sends:
- gold above `supply.goldKeep` (10k), if at least 5k;
- every item stack except `supply.keep` (Tracktrix), class items (priest: Essence of Life, ranger: Poison Sack), reserved gear and current potions.

**Self-buying.** Below 20 potions with no merchant answer for 3 min, the fighter walks to town and buys up to 300.

## 22. Death handling

On death the fighter logs the last 10 s of hits (`[death] last 10 s: …`).
- **Blame:** the monster kind that dealt the most damage is blocked as a farm target for 1 h, stored across restarts (`dmpx_farm_experience`). A member reports it to the leader.
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
| **Agitate** (lvl 68) | 3+ monsters on allies, with no bystanders in reach. |
| **Cleave / Stomp** | 3+ / 2+ monsters around, never near damage-return monsters. |
| **War Cry** | Party: targets needing 4+ hits. Solo: before a pull-point Agitate. |

**Agitate pack mode** (solo, `classes.warrior.agitate`):
- **Automatic** (`monsters: "auto"`): the warrior decides per farm target. It is allowed only on monsters that pass a pack safety check (a pull may cost at most 35 % of max HP), are slower than us, have no damage return and no abilities. A running mode goes off on a live "no" (pack check or level cap for what is in reach) only after it held for `offAfterMs` (60 s, v1.215.0) - at the CGoos it flipped swords <-> off every 15 s as grown and fresh ones walked in and out of reach; every single Agitate checks what is in reach anyway. Fixed reasons (a death, damage return, abilities, speed, a new farm target) switch at once.
- **Splash or swords:** after 40 hits it learns the splash neighbours per hit. From 1.0 it uses the splash weapons (Lolipop Maces); before that it guesses from spawn density.
- **Splash without Agitate** (`splashOnlyFrom` 3): with 3+ on him the Lolipops go on even where Agitate is off - since v1.213.0 only when he survives what the splash would pull: those on him plus every free monster chained within the splash radius + `splashPullSlack` (40 px), three rounds deep. Party: the team model (healing counts); solo: the pack check's safe count. Log: `no splash: it would pull N (...)`.
- **Not on the way** (v1.213.1): while a path walk runs (an event call, a spot change, following the leader) the splash weapons come off at once and don't go on again - they slow us down, and leaving the Giant Scorpions for the Phoenix with the scorpions behind him, the warrior defended himself with the Lolipops past the Fire Spirits. Log: `splash weapons off: on the way`.
- **Stream mode:** Agitate on cooldown, with at most 5 monsters on us (fewer at low HP), walking to clumps.
- **Safety:** after three low-HP moments in 10 min it pulls fewer. A death within 90 s of an Agitate denies Agitate on that kind for 2 h (`deathDenyMs`).
- **Escape triggers since v1.216.0** (solo and party), besides low HP and the mob check: **real HP loss** - the HP actually lost over the last `escapeLossSec` (3 s; every hit, burn, heal and potion included) would kill him within 8 s; or a **monster rejected even alone** - one on him that the team model (party) or the pack check (solo) rejects as a single monster, e.g. a Fire Spirit ("abilities: burn"). Bosses never count as rejected. Why: a Fire Spirit pulled into the Giant Scorpions by another player killed him with "1 on me" - 17,262 damage in 10 s from stacking burn, which the hit formula doesn't know. The usual speed rule stays: he only runs from monsters slower than him.
- **Party escape** (`agitate.partyEscape`, v1.207.0): in a party the warrior runs too, but only when the live check says he dies within 8 s. The check includes the healing of every healer in reach (heal/s × `mobbing.healShare` 0.8). It applies with a mob (more than 3 on him, below 70 % HP) or below 30 % HP; low HP the priest covers doesn't count. All monsters follow him, the mobbing combo runs out after 5 s without a hit, and the priest heals meanwhile. Escape steps stay within the healer's reach where they can. The escape ends when he is back at 60 % HP and the combo has run out.
- **Protective Agitate** (party, v1.207.0): with 3+ monsters on allies, Agitate only when the team model (mobbing, fear, healing) says the warrior can hold **everything** Agitate would take (all within 320 px plus those already on him). Otherwise Taunt takes them one by one. Log: `no protective Agitate: N would be on us (...)`.
- **Team stats:** every fighter sends its stats to every other one each minute, not only to the leader (v1.207.0). The warrior's live check needs the priest's healing.
- **Gap step** (`agitate.gapStep`, solo and party, v1.205.0): the splash hits what stands around the *target* (explosion ÷ 3.6 px, hitbox to hitbox), there is no facing. When the splash weapons are on, 3+ monsters are on the warrior and the best target's splash misses one in range (e.g. one behind him), he steps 50 px into the **largest angle gap** between them. They all follow from one side and bunch up. At most every 4 s, from 2.5 s on when all are in range again. Never into free monsters, a failing rage zone, or (member) off the leash. Every 10 min the log shows the steps and the splash per hit.
- **Escape** (solo, v1.201.0): below 30 % HP (`escapeHp`) it runs from slower monsters, with no swings. It runs as long as something on it can still reach it: that monster's range + 100 px (`escapeMargin`), at least 250 px (`escapeClear`). Once out of reach it stands still and lets the potions work, until it is back at 60 % HP (`escapeUntilHp`). The escape also ends when nothing targets it any more, or after 45 s (`escapeMaxMs`). Each step tries 16 directions at 200, 120 and 70 px and takes the one with the most room to the nearest attacker. Cornered (no step leads away): it fights on and tries again after 5 s.
  - **Not into other dangers** (v1.213.0): a step whose point (or the middle of the way) comes within a free dangerous monster's range + `escapeKeepOff` (80 px, at least 150 px) or into another aggressive spawn's box (+ 80 px) is taken only if nothing else is left. Twice the warrior fled into the Fire Spirits ~300 px south of the Giant Scorpions and died.
- **Override:** `/agitate` switches the mode by hand (off, swords, splash, chain, splashstream).

**Sword swap** (`swordSwap`). Active only while Fiery Blades are worn:
- quick targets (≤ 5 hits) get the two best Swords of the Dead, because burn needs ~5 s and never procs on the killing hit;
- longer fights, bosses and events bring the blades back;
- the swords stay reserved in the bag.

### Priest (`classes.priest`)

| Skill | When |
|---|---|
| **Heal** | Most hurt member below 75 % (shares the attack cooldown). Self below 60 %. |
| **Party Heal** | 2+ members below 65 %, one below 35 %, or any other member below 50 % (also out of sight, from its heartbeat). |
| **Absorb Sins** | A non-tank below 35 % with monsters on it and no tank in Taunt range, while we are above 60 %. |
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
- **Mage:** Energize to members below 40 % MP; Mana Burst is off.

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
- **Wanderer's pieces** are sold only when no non-tank can still use the copy.

**Banking.**
- **When:** fewer than 6 free bag slots (`bank.whenFreeBelow`), or 30 min since the last visit.
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
- **Logs:** every trade goes to `dmpx_trade_log`.

## 27. Ponty rounds over all servers

`merchantRole.pontyRound`: every full hour (`everyHours: 1`, in minutes 0–29), or on `/ponty`.

1. **Prep:** call every fighter for a pickup and serve them; then sell, bank and leave.
2. **Travel:** hop to each server in `servers` (EU, US, ASIA, PvP; the home server is skipped). On each server:
   - bank if the bag is nearly full;
   - visit Ponty and buy what the rules allow ([§28](#28-workshop-wishes-and-upgrades));
   - with a full bag: bank and visit again (up to 2 times).
3. **Home:** log `Ponty round done in N min: …` and append the round to `dmpx_ponty_round_log`.

**Home server** = the server in the leader's heartbeat. A merchant restarted elsewhere asks to hop home.

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
- **Log:** every purchase goes to `dmpx_ponty_bought`.

## 29. Workshop: gear goals and stages

`workshop.gearGoals` pushes what the fighters wear to `upTo` (+8) when there is time.

- **Slots:** helmet, chest, pants, shoes, gloves, mainhand, and the offhand when it holds a weapon.
- **Team-wide stages** (`stages: [7, 8]`): everyone's shop gear reaches +7 before anyone goes to +8.
- **Shop pieces** are re-buyable, so every attempt is made. Finished copies get the fighter's main-stat scroll and are delivered; the old piece comes back as a base.
- **Shop weapon goal:** a fighter wearing a drop weapon gets its class's shop weapon built to +8 if that would beat the drop weapon.
- **Off-plan armor** (v1.206.0). An armor slot that is **empty** or holds a piece **outside the class's gear plan** gets the plan's next step. The plan here means: shop piece, Wanderer's equivalents for non-tanks, wish chains with their alternatives, and found items.
  - A wish chain with `replace` (Rugged for tanks, Wanderer's for the priest) already does this.
  - Otherwise the shop piece is built at the current stage with the main stat. A fighter whose shop armor is done (all at the last stage) uses the team stage, or the last one (v1.210.8; before, the ranger with all pieces at +8 got nothing for his chest). Only if it is at least as good as the worn piece in main stat and in armor + resistance, and better in one.
  - Log: `VizRng chest: tshirt1 +3 is outside the gear plan - building coat +8 dex`.
  - Why: the ranger's lucky T-Shirt +3 (9 DEX, nothing else) kept the gear goals from ever building his Coat +8 (12 DEX, 12 armor, 10 resistance).
- **Wanderer's set** (`gearPlan.equivalent`, non-tanks):
  - A Wanderer's piece is built at least to the level of the worn shop piece of its slot (or to the stage) and replaces it. Example: the ranger's helmet +7 → Wanderer's Cap +7 (DEX).
  - From then on it is upgraded instead of the shop piece.
  - Pieces are crafted from stock only when every ingredient is in the bank (`craftFromStock`).
  - Tanks wear the Rugged set instead.
- **Stat scrolls:** a copy whose stat another fighter wishes for is never re-scrolled.
- **Pot empty:** `gear goals wait for income …`, retry in 15 min.

## 30. Workshop: weapons and material goals

**Weapon lists** (`gearPlan.weapons`, worst → best):

| Class | List |
|---|---|
| warrior | Blade → Sword of the Dead → Fiery Blade |
| priest | Staff → Fiery Staff → Staff of the Dead |
| ranger | Bow → Firebow |
| rogue | Stinger → Dagger of the Dead |

**Planner.** The planner walks each list **from the back**. It takes the first item it can work on that, at most at its cap (`weaponCaps` 7), beats the fighter's weaker weapon hand by 3 % (`betterWeapons.margin`). Shop weapons are left to the gear goals; fire and Dead weapons to the material goals.

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
  - Vitality Earrings are held at +0 while buyers pay 500k+, and compounded no higher than +2.
- **Exchanges** (`workshop.exchange`):
  - Seashells and Leather are exchanged, 10 at a time, while 8+ bag slots are free.
  - Gems and Market Parcels are held (`hold`).
  - Armor Boxes are opened only when a wished Rugged piece can come out (3 at a time, bank with 10+ free slots).
- **Rugged spares** (`boxArmor`): while a Rugged piece is wished, spare copies are upgraded towards +7.
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

**Heartbeat.** Every bot writes `dmpx_beat:<name>` (`{at, server, hp, rip}`).

**Watchdog** (`watchdog`). The client that hosts a bot window restarts it when its heartbeat is 2 min old or the window is gone.
- At most one restart per 10 min and 3 per hour; then it gives up with a red log.
- The leader's own window is not covered.
- A member stopped on purpose comes back too.

**Server hops.**
- `change_server` is never used from code: from a bot window it opened a full game.
- Instead the merchant writes a hop request (`dmpx_hop_request:<merchant>`). The client hosting the merchant's window re-creates it on the other server (hop watcher in `main.js`).
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
| `gearGoals.budget.extra`, `bruteForce.extra` | Not set; the pots run on income only. Add `{ amount, until }` for a one-off. |
| `classes.warrior.dash` | Off. |
| `events.farmBosses` | Empty: no nonstop boss hunting. |
| `cavalry.targets` | Empty: no nuking for loot. |
| `hunts.enabled` | Off during the warrior's solo phase. |
| `combat.dangerShare` | Not in config; the code default (1) applies. |
| `party.leash` | No follow or kite leash any more. Read only by the warrior's Agitate (gap steps, stream walks, catching up) and by the rage-zone check: a member with the leader within 300 px judges a zone with the team model ([§11](#11-safety-checks)). |
| Fixed thresholds | Priest Curse (5 hits), paladin Smash (2 hits) and Guardian's Oath (own HP > 50 %) are in the code, not the config. |
| Market buy orders | A `market.buy` order needs gold ≥ one unit's price, not the whole quantity. |
| Auto compounding | Does not check wishes: any compound item below +3 with 3 spare copies (beyond `compound.keep`, not Vitality Earrings held for buyers) is combined. |
