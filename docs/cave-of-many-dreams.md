# Cave of Many Dreams - reference

Collected 2026-11-24 from the official guide (`get_doc cave-of-many-dreams`) and the deployed game data
(`G.events.dreams`, `G.monsters.cave_*`, `G.drops.cave_*`, `G.items.cave_*`, game data version 18285).
The public server code on GitHub (`kaansoral/adventureland`, last push 2026-03-01) does not contain the cave yet,
so the server-side logic of several effects is unknown (see "Open questions").

Goal (player decision 2026-11-24): automate the cave completely once we judge it doable. The first runs are done
by hand to learn the flow; this file is the starting point for the decision rules.

## Basics

- Party of 3, 3 floors, 24 minutes, 10x enemy XP. No level requirement in the guide or the event data.
- One visit per account per day (shared by all characters of the account), reset at midnight on the home server.
  A server restart that ends the visit gives it back; reloading or disconnecting does not.
- Entrance: Dorr at the vine-covered doorway in Mainland, near 816,1200 (`dreams_gate`). The party stands close,
  out of combat, and chooses Enter together. Magiport cannot enter or leave the cave.
- Each floor: guard camp (3 packs, a chest per pack: 1,500 cave gold + 1 Amber), floor keeper (chest: 4,000 cave
  gold), and a marked encounter. All three open the stairs. Floor 3 done: extra `cave_finish` reward and a chest with
  10,000 cave gold + 5 Amber.
- Death costs nothing (no XP, gold or items). Revive at the floor doorway is free, in place costs 1 Amber per
  fallen character (shared purse). Respawn calls Nera; Exit leaves for good.
- Forced votes pause the cave and the 24-minute clock. One vote per character (fallen ones too), one minute; a
  majority settles early. Our three bots voting the same settles every vote at once.
- Cave gold only exists inside the cave (spend it at merchants or in encounters). Unspent Amber goes to the party
  on exit or at the end. Limits per run: `gold_limit` 60,000, `amber_limit` 36.
- NPC rewards and merchant items go to a random member of the original party (bag, or MAIL when full/offline).
- Items with the Cave title give +5 magic resistance each while equipped.

## CODE

- `character.cave` (null outside): `floor` (0-2), timer, purse, objectives, door locations, `paused`, `choice`.
- Map IDs change every visit: use `character.map`.
- `cave_info()` (daily visit, `resume` with run/server/remaining_ms), `cave_enter()` (beside Dorr; also resumes),
  `cave_reply(choice.id, option.id)`, `cave_buy(room)`, `cave_exit()`, `cave_talk(room, actor)`.
- `character.on("cave", state => ...)` delivers the state; a vote is `state.choice` with `options` (id, cost, amber,
  `unavailable` reason) and `resolved`.
- Pause combat while `character.cave.paused`. Chests: `loot(id)` within 400 px (`parent.chests`), not while fallen
  or paused. Cave monsters' `target` is the player name or null.
- Client functions (no outcome logic in the client): `cave_request`, `receive_cave_state`, `update_cave_doors`,
  `cave_stair_goals`, `render_cave_choice`, `cave_receive_rewards`, `draw_cave_chests`, ...

## Monsters

| key | name | HP | attack | type | armor / res | freq | speed | XP (x10 in cave) |
|---|---|---|---|---|---|---|---|---|
| cave_rat | Cave Rat | 820 | 80 | phys | 0 / 0 | 1.2 | 42 | 640 |
| cave_crab | Cave Crab | 400 | 24 | phys | 160 / 0 | 0.65 | 26 | 500 |
| cave_snake | Cave Snake | 720 | 24 | phys | 0 / 0 | 1.4 | 52 | 1,600 |
| cave_guard | Cave Guard | 1,200 | 35 | phys | 10 / 10 | 1 | 45 | 100 |
| cave_npc | Cave Traveler | 1,200 | 35 | phys | 10 / 10 | 1 | 45 | 0 |
| cave_rogue | Cornered Rogue | 1,200 | 35 | phys | 10 / 10 | 2 | 70 | 0 |
| cave_bat | Cave Bat | 9,600 | 50 | phys | 0 / 120 | 1.3 | 70 | 8,000 |
| cave_broodmother | Amber Broodmother | 8,000 | 80 | phys | 0 / 0 | 1 | 28 | 12,000 |
| cave_spider | Cave Spider | 18,000 | 80 | phys | 0 / 0 | 1 | 44 | 12,000 |
| cave_scorpion | Cave Scorpion | 24,000 | 100 | phys | 200 / 0 | 0.8 | 38 | 20,000 |
| cave_wolf | Cave Wolf | 48,000 | 480 | phys | 300 / 200 | 1.1 | 80 | 48,800 |
| cave_lockbreaker | Lockbreaker (keeper) | 12,000 | 100 | phys | 300 / 10 | 0.6 | 45 | 0 |
| cave_sentinel | Counterweight Sentinel (keeper) | 16,000 | 140 | phys | 500 / 10 | 0.5 | 45 | 0 |
| cave_mothkeeper | Moth Keeper (keeper) | 14,000 | 90 | magic, range 240 | 10 / 10 | 0.7 | 45 | 0 |
| cave_darkmage | Dark Mage (rare 0.2 %) | 1,000 | 100,000 | magic, range 320 | 0 / 0 | 0.25 | 25 | 0 |

- Cave Wolf is the only real test (5 in the Deep Roost pack). Our team 2026-11-24: warrior 72 with 10.9k HP and
  armor 419, priest heal 1,889 at ~1/s.
- Six level 100 wolves come only from the `wolves` effect (`e10_0`, `e12_2`): never pick those.
- Dark Mage: 100,000 magic damage, targets mages first, immune; only his own reflected spell can kill him. Avoid.
- Bats sleep until you get close (traveler Bram).
- Camps per floor (one of two):
  - Floor 1: Amber Nest (6 rats + 2 spiders / 6 bats / broodmother + 3 spiders) or Bat Roost (8 bats / 6 spiders /
    broodmother + 4 bats).
  - Floor 2: Flooded Hollow (7 crabs / 6 snakes / 2 scorpions + 4 crabs) or Guard Outpost (4 guards + 2 wolves /
    4 guards / 3 guards + 3 scorpions).
  - Floor 3: Venom Burrow (6 snakes + 2 scorpions / 6 spiders / broodmother + 3 scorpions) or Deep Roost (6 bats +
    2 spiders / 5 wolves / broodmother + 4 bats).
- XP of a whole run is small (roughly 5-8M); the value is Amber and the cave items.
- Monster drops (`G.drops.monsters`, luck counts): every cave monster 8 % 1 Amber; spider +3 % Spider Silk, scorpion
  +3 % Cobra Scale, snake +3 % Snake Oil; **Broodmother 100 % 1 Amber** + 10 % Spider Silk. Travelers, rogue and floor
  keepers drop nothing and give 0 XP (their reward is a table roll) - a keeper summoned by an encounter probably pays
  nothing. Dark Mage: 100 % Nightjudge (`G.drops.cave_darkmage`); rogue: Last Word (`cave_rogue_weapon`).

## Reward tables (`G.drops`)

A "roll" is one draw from the table right away (not an item to keep); items go to a random member of the original
party. About 1,000 cave gold = 1 Amber (Loaded Die: 10,000 cave gold at the merchant or 10 Amber at Cole).

| table | used for | content (weight) |
|---|---|---|
| cave_farm | each cleared camp pack (most likely; the guide's "clearing monster packs" table) | 57 Amber x1, 20 Amber x2, 10 scroll1, 4 Tunnel Axe, 4 Reed Scythe, 3 Locktooth, 2 Mothstep Boots |
| cave_parcel | bought parcels, trials, hunts, fights with hostile travelers | 50 Amber x1, 22 Amber x2, 10 scroll1, 5 gem1, 5 Tunnel Axe, 5 Reed Scythe, 2 Locktooth, 1 Mothstep Boots |
| cave_rescue | successful rescue/escort, helping the winning rival | 60 Amber x2, 20 Amber x3, 10 gem1, 5 Tunnel Axe, 3 Counterweight, 2 Mothstep Boots |
| cave_boss | floor keepers | 55 Amber x3, 15 Locktooth, 12 Counterweight, 10 Tunnel Axe, 8 Mothstep Boots |
| cave_finish | floor 3 completed | 45 Amber x5, 15 Locktooth, 15 Counterweight, 10 Tunnel Axe, 10 Mothstep Boots, 5 Loaded Die |
| cave_finish_bonus | floor 3 completed, luck has no effect | 0.1 % Deepvein Axe, 0.1 % Amberweave Coat |

## Items and Cole's recipes

| item | slot | stats | recipe (at Cole, Mainland) |
|---|---|---|---|
| Cave Amber | material | - | tradeable between players |
| Reed Scythe | scythe | atk 30, dex 2, speed 3, eva 1 | wbasher + blade + spidersilk + 500 (Gabriel sells it for 16,000) |
| Tunnel Axe | axe | atk 39, str 2, armor 16, apiercing 8, courage 1 | 8 Amber + blade + wbasher + 12,000 |
| Locktooth | short sword | atk 21, apiercing 40 | 6 Amber + blade + 2 reefglass + 8,000 |
| Counterweight | shield | armor 90, res 20, hp 120, courage 2, speed -2 | 8 Amber + wshield + dstones + 12,000 |
| Mothstep Boots | shoes | armor 8, res 8, speed 8, eva 4 (+35 eva, +20 speed in the Cave of Darkness) | 6 Amber + shoes + 2 beewings + 12,000 |
| Loaded Die | orb (compound) | crit 8, critdamage 10; one reroll per visit on a missed cave roll | 10 Amber + 8 seashell + 2 reefglass + 16,000 |
| Deepvein Axe | axe | atk 48, str 4, crit 2, apiercing 30, lifesteal 1 | 200 Amber + Tunnel Axe +0 + 10 gemfragment + 20 leather + 480,000 |
| Amberweave Coat | chest | armor 42, res 28, hp 100, luck 3, eva 2 | 300 Amber + coat + 30 spidersilk + 20 cscale + 360,000 |
| Last Word | dagger | atk 28, crit 5, apiercing 80, speed -4 | rare: Cornered Rogue (1 %), only if monsters kill him |
| Nightjudge | staff | atk 48, rpiercing 80, range 60 | Dark Mage (100 %) - only his reflected spell kills him |

Merchant stock (cave gold, one copy each): Tunnel Axe 6,000, Reed Scythe 2,500, broom 48,000, tshirt0/1/2 16,000,
**Loaded Die 10,000**, Locktooth 6,000, Counterweight 8,000, Mothstep Boots 6,000, scroll1 2,000, gem1 5,000.
One merchant per floor near the doorway, along an upper wall. Cave gold never leaves the cave: spend it.

## Rules of thumb (first draft, to be checked on the manual runs)

- Never: `wolves` effect (`e10_0`, `e12_2`), `e17_0` (copy of our strongest fighter), dice for a Loaded Die
  (`e01 die`: 6 Amber for a 1/6 chance, the recipe costs 10 Amber).
- Free and safe: `e07_4` (100 % parcel) and the 20-second `careful` options (`e02_2`, `e09_4`, `e15_4`, `e17_4`,
  `e22_2`, `e40_4`).
- A 50/50 between a reward and an easy fight is good: the worst case is a fight we win. Best: 50 % `cave_boss`
  (`e04_0`, `e13_0`, `e22_0`). Not with wolves: `e21_2` (3 wolves for half a parcel) was dropped (player review
  2026-11-24), `e06` takes `cover` on the first run (no wolf fight; count the wolves).
- Fights with hostile travelers (1,200 HP) pay a parcel roll (guide): `e05_2` instead of `e05_1`.
- Sure cave gold beats an unverified fight reward: `e03_4` (2,000) instead of the six rats.
- Every pen in `e08` pays the same box: the three crabs are quickest; keepers from encounters give nothing extra.
- Tolls (`e26`-`e30`): test `_5` once (the NPC + six guards, all trivial: six guard drops and probably a parcel roll
  for the hostile traveler); else `_1` (three guards, free).
- Conflicts: `testimony` (help whoever hits harder) - only helping the winner pays `cave_rescue`.
- Cornered Rogue (`e20`): `watch` - the only way to Last Word; a betrayal is harmless at 1,200 HP.
- Hunts: the double variant (12 crabs in 90 s, 20 rats in 60 s; 16 bats in 75 s only if they are close).
- Tools (`e38`, `e49` and the others): on floor 1 without a tool the pry bar (used by `e02`, `e12`, `e18`, `e22`);
  later or with a tool, 1 Amber. A lamp only for `e47 moths` - free ones (`e21_4`, `e23_4`, ...) are fine.
- Spend all cave gold; Loaded Die first, then cave items by use.

## First run 2026-11-24 (manual, priest + mage; extracts in `docs/cave/runs/2026-11-24-run1-*.json`)

Result: 29 Amber, 4 Reed Scythes, Mothstep Boots (+ a Tunnel Axe), floors 1 and part of 2 in 24 min with two
characters. Recorder gaps: the priest's 300 entries only reach back to 10:44 (one state per clock tick, 3,000 chars
each - truncated), so floor 1's votes are missing; to fix before the next run.

- **Entering:** Dorr's "Enter together" takes the whole party (it must stand close). A member that calls
  `cave_enter()` alone gets `bring_party_to_keeper`.
- **The warrior left after one minute** (10:28:18, right after the first vote resolved) and could not return
  (`roster[].left: true`; re-entering gives `bring_party_to_keeper`). Most likely our follow logic walked him out;
  v1.231.3 forbids path walks to another map inside the cave.
- **Votes:** only **2 of the 6 options** are offered per encounter - we need a ranking of all six, not one pick.
  `If nobody wins the vote` is shown in the dialog (the shop: "Walk away"). The member vote relay worked (the
  warrior voted `e31_0` with the leader, the mage `landing` and `e05_0`; `resolved: true` at once).
- **Stairs are a vote too:** option `landing` (choice when reaching the open stairs) moves the whole party to the
  next floor - the mage came along by itself.
- **Monsters scale to the party level** with one shared stat block: at level 73 every regular cave monster had
  3,665 HP, 187 attack, 110 armor, 73 resistance, 39,670 XP (rat and spider identical; only speed, range,
  frequency and rage differ). Cave Traveler (neutral): 19,732 HP, 281 attack. The base values in `G.monsters`
  do not apply. Floor 2 was somewhat harder than floor 1, both easy for priest + mage.
- **INFO -> Directions** lists every room of the floor (camps with pack count, encounters, shop, keeper, stairs,
  exit) with a "Go" button that path-walks there (client `cave_walk_to`). The same data is in the state.
- **Merchants:** a one-item shop on floor 1 (16,000 for a DEX T-shirt) and one right after the stairs on floor 2.
  `cave_talk` needs to stand close (`distance` error otherwise).
- Camps gave chests with 1,500-5,000 cave gold and 1-3 Amber; ~13,000 cave gold and 19 Amber after floor 1.

**`character.cave` state** (from the recorder): `run`, `expires`, `server_time`, `remaining_ms`, `paused`,
`paused_at`, `rewards[]` (`{where: "purse"|"inventory", gold, amber, map, x, y, id}` or `{item: {name, level,
p: "cavefound"}, recipient, where, slot}`), `level`, `floor` (0-2), `gold`, `amber`, `limits` (`gold`, `amber`,
`gold_spawned`, `amber_spawned`), `supplies[]`, `roster[]` (`{name, left, disconnected}`), `doors[]`
(`{id, x, y, map, to, down, locked}` - floor 1: exit to main at 912,288 and the stairs at 3552,2704),
`objectives[]` (`{id, x, y, done, floor, kind: "encounter"|"farm"|"fight"|"boss", required, waves, name}` -
three `required` ones per floor: guard camp `fight`, marked `encounter`, keeper `boss`), and during a vote
`choice` (`{id, title, kind, danger, scene[] (NPCs with side and hp), text, deadline, resolved, summary,
votes: {}, options[]}`). Cave entities carry `cave: {room, side: "enemy"|"neutral"|..., citizen}`.

## Open questions (answer on the manual runs)

- What the effects without data do: `save`/`watch`/`lure`/`hire`/`both`/`cover`, `left`/`right`/`neither`/`peace`/
  `testimony`, `escort`/`guide`, `bad_fight` vs `bad_double`, `hunt_helper`, `practice` (trainer strength),
  `moths`, `plant`, `reveal`/`appraise`, `favor`, `dice_room`, `gift`, `exchange`, `use_tool`.
- Whether a plain monster fight from a `venture` outcome gives a reward of its own.
- What `offer: true` on an option means (probably the options shown by default or suggested).
- How rooms, doors and objectives look in `character.cave` - record the state on the first run.

## Encounters (generated from `G.events.dreams.encounters`)

Outcomes are listed with their weights; `rec` marks our current pick, `avoid` an option never to take.

### e01 Dice in a Tin Cup (dice, mixed)

Pick your bet, then roll once for the whole party. Stakes come from your shared gold or Amber, and the listed payout includes the stake.

- `small` Bet 2,000 shared gold; roll 4–6 to get 4,000 - cost 2000 gold; win 4000; effect `dice`
- `large` Bet 5,000 shared gold; roll 4–6 to get 10,000 - cost 5000 gold; win 10000; effect `dice`
- `six` Bet 2,000 on a six; win 12,000 - cost 2000 gold; win 12000; effect `dice6`
- `die` Bet 6 Amber on a Loaded Die; win on a six **[avoid]** - cost 6 Amber; effect `die`
- `favor` Roll 4–6 for a helper; 1–3 brings two guards **[rec]** - effect `favor`
- `door` Roll for a fight: four rats or four crabs - effect `dice_room`

### e02 The Unclaimed Parcel (parcel, mixed)

This box has been sitting here for days. I can sell it to you, but fair warning: it rattles when nobody touches it.

- `e02_0` Cut the seal. Something inside is scratching. **[rec]** - 50%: cave_parcel | 50%: FIGHT 3x cave_guard
- `e02_1` Pry the hinges off quietly. - needs tool; 100%: cave_parcel
- `e02_2` Spend 20 seconds checking the trap. - effect `careful`
- `e02_3` Buy the box for 2,000 shared gold - cost 2000 gold; 100%: cave_parcel
- `e02_4` Ring the alarm and take what the guards carry. - 100%: FIGHT 3x cave_guard
- `e02_5` Leave it and keep going. - effect `leave`

### e03 Feed the Vault (lure, mixed)

I keep rats for the wolves. You can help clear the pen, buy some bait, or take the tame one along.

- `e03_0` Open the rat gate. Fight six rats for the parcel. - 100%: FIGHT 6x cave_rat
- `e03_1` Put your hand through the bars. - 50%: cave_parcel | 50%: FIGHT 2x cave_wolf
- `e03_2` Buy a rattling feed tin for 2 Amber - cost 2 Amber; 100%: flag decoy
- `e03_3` Free the tame rat. Let it follow us. - 100%: ally cave_rat
- `e03_4` Sell the spare feed for 2,000 cave gold **[rec]** - 100%: 2000 cave gold
- `e03_5` Leave it and keep going. - effect `leave`

### e04 The Hot Forge (forge, mixed)

There’s a supply box stuck behind the hot forge. We can force it out, buy a cooled one, or decide it isn’t worth the burns.

- `e04_0` Pull the box out now; the guard may hear **[rec]** - 50%: cave_boss | 50%: FIGHT 1x cave_lockbreaker
- `e04_1` Buy the cooled box for 4 shared Amber - cost 4 Amber; 100%: cave_parcel
- `e04_2` Wake the forge keeper on purpose. - 100%: FIGHT 1x cave_lockbreaker
- `e04_3` Borrow the smith’s pry bar. - 100%: flag tool
- `e04_4` Sell the scraps to the smith for 2 Amber - 100%: 2 Amber
- `e04_5` Leave it and keep going. - effect `leave`

### e05 The Guard’s Contract (hire, mixed)

Need another sword? Pay me now and I’ll fight beside you. Or trust the guard offering to lead you for free. Your call.

- `e05_0` Hire the guard for 2,000 shared gold - cost 2000 gold; 100%: NPC joins
- `e05_1` Let the guard lead. No money up front. - 50%: NPC joins | 50%: FIGHT 3x cave_guard
- `e05_2` Fight the guard for the contract chest **[rec]** - 100%: FIGHT 1x cave_npc
- `e05_3` Take a route with fewer guards - 100%: flag truce
- `e05_4` Buy a spare lamp for 1 Amber - cost 1 Amber; 100%: flag lamp
- `e05_5` Leave it and keep going. - effect `leave`

### e06 The Trapped Surveyor (rescue, mixed)

Wolves have cornered {npc}. “Help me! Kill these wolves and I’ll share what’s in my pack.” You could also wait and search the pack if the wolves kill them.

- `save` Save {npc}: fight the wolves - effect `save`
- `watch` Wait; loot the pack if {npc} dies - effect `watch`
- `lure` Draw the wolves away from {npc} - effect `lure`
- `aid` Save and hire {npc} for 2,000 shared gold - cost 2000 gold; effect `hire`
- `finish` Attack {npc} and the wolves - effect `both`
- `cover` Bring {npc} behind us; take a smaller reward **[rec]** - effect `cover`

### e07 Borrow a Uniform (disguise, mixed)

I took these coats from the guards. One will get you through a guardroom. Take the captain’s, though, and he may notice.

- `e07_0` Pay 2 Amber for a guard’s coat. Skip the next guardroom. - cost 2 Amber; 100%: flag truce
- `e07_1` Steal the captain’s coat; he may catch us - 50%: 2000 cave gold + flag truce | 50%: FIGHT 3x cave_guard
- `e07_2` Challenge the captain for the coat - 100%: FIGHT 1x cave_rogue
- `e07_3` Take a discarded lamp from the locker - 100%: flag lamp
- `e07_4` Search the pockets for supplies **[rec]** - 100%: cave_parcel
- `e07_5` Leave it and keep going. - effect `leave`

### e08 Pick a Fighter (arena, mixed)

Pick a pen and fight whatever’s inside. Win and you get something from my supply box. Crabs, bats, wolves—and one very large Lockbreaker.

- `e08_0` Choose three crabs. Slow, but armored. **[rec]** - 100%: FIGHT 3x cave_crab
- `e08_1` Fight six bats - 100%: FIGHT 6x cave_bat
- `e08_2` Choose the wolf pair. They move together. - 100%: FIGHT 2x cave_wolf
- `e08_3` Choose the Lockbreaker. One large opponent. - 100%: FIGHT 1x cave_lockbreaker
- `e08_4` Let the handler choose your opponent - 50%: cave_parcel + 3000 cave gold | 50%: FIGHT 4x cave_wolf
- `e08_5` Leave it and keep going. - effect `leave`

### e09 Finish the Golem (construct, mixed)

This golem hasn’t moved in years. A proper repair costs 4 Amber. That loose stone might wake it too, but I can’t promise it’ll be pleased to see us.

- `e09_0` Use 4 Amber to repair its chest - cost 4 Amber; 100%: ally cave_sentinel
- `e09_1` Fit the loose power stone **[rec]** - 50%: ally cave_sentinel | 50%: FIGHT 1x cave_sentinel
- `e09_2` Remove the stone while it’s awake - 100%: FIGHT 1x cave_sentinel
- `e09_3` Sell the broken plates for 2 Amber - 100%: 2 Amber
- `e09_4` Spend 20 seconds opening its storage hatch - effect `careful`
- `e09_5` Leave it and keep going. - effect `leave`

Note: ally golem for the rest of the run, or a sentinel fight.

### e10 The Handler and the Wolves (wolves, mixed)

The red chain opens the big pen. Six level 100 wolves in there. If you prefer your odds less insulting, try the smaller pen.

- `e10_0` Pull the red chain: six level 100 wolves **[avoid]** - effect `wolves`
- `e10_1` Open the small pen instead - 100%: FIGHT 2x cave_wolf
- `e10_2` Buy a tin rattle for 2 shared Amber - cost 2 Amber; 100%: flag decoy
- `e10_3` Reach for the handler’s purse - 50%: cave_parcel | 50%: FIGHT 4x cave_wolf
- `e10_4` Pay 2,000 cave gold for the locked crate **[rec]** - cost 2000 gold; 100%: cave_parcel
- `e10_5` Leave it and keep going. - effect `leave`

### e11 Two People Claim the Chest (conflict, mixed)

{npc} carried the chest here. {rival} has the key. They both claim it, and neither looks interested in compromise.

- `left` Help {npc} fight {rival} - effect `left`
- `right` Help {rival} fight {npc} - effect `right`
- `neither` Let them fight; collect what’s left - effect `neither`
- `both` Fight both and take the chest - effect `both`
- `peace` Pay 3,000 shared gold to stop the fight - cost 3000 gold; effect `peace`
- `testimony` Help whichever fighter hits harder **[rec]** - effect `testimony`

### e12 The Bell Ropes (bell, mixed)

These ropes ring the guard bells. Short calls three guards. Long calls their keeper. Red opens the wolf pen. At least they’ve made the bad ideas easy to tell apart.

- `e12_0` Pull the short rope. Wake three guards. **[rec]** - 100%: FIGHT 3x cave_guard
- `e12_1` Pull the long rope. Wake the keeper. - 100%: FIGHT 1x cave_mothkeeper
- `e12_2` Cut the red rope: level 100 wolves **[avoid]** - effect `wolves`
- `e12_3` Take the loose bell as a decoy - 100%: flag decoy
- `e12_4` Use a pry bar to open the bell’s base - needs tool; effect `use_tool`
- `e12_5` Leave it and keep going. - effect `leave`

Note: e12_4 instead if we carry a pry bar.

### e13 The Strong Magnet (magnet, mixed)

The magnet pulls loose metal out of the walls. Turn it up too far and it might pull the armored sentinel over here as well.

- `e13_0` Turn the magnet all the way up **[rec]** - 50%: cave_boss | 50%: FIGHT 1x cave_sentinel
- `e13_1` Sell the loose metal for 2 Amber - 100%: 2 Amber
- `e13_2` Pull the sentinel’s shield toward the party - 100%: FIGHT 1x cave_sentinel
- `e13_3` Pay 2 Amber to use the small magnet - cost 2 Amber; 100%: cave_parcel
- `e13_4` Take the magnetic latch for a stuck hatch - 100%: flag tool
- `e13_5` Leave it and keep going. - effect `leave`

### e14 Two Couriers, One Badge (conflict, mixed)

{npc} and {rival} both claim the delivery. Each says the other stole it, and they’re about to settle the matter with steel.

- `left` Help {npc} fight {rival} - effect `left`
- `right` Help {rival} fight {npc} - effect `right`
- `neither` Let them fight; collect what’s left - effect `neither`
- `both` Fight both and take the chest - effect `both`
- `peace` Pay 3,000 shared gold to stop the fight - cost 3000 gold; effect `peace`
- `testimony` Help whichever fighter hits harder **[rec]** - effect `testimony`

### e15 Letter to the Captain (letter, mixed)

I need this letter delivered to the captain. He might pay you for it. He might also decide whatever it says is your fault.

- `e15_0` Deliver the letter; the captain may blame us **[rec]** - 50%: cave_rescue + 3000 cave gold | 50%: FIGHT 2x cave_npc
- `e15_1` Open the letter in front of the captain - 100%: FIGHT 1x cave_npc
- `e15_2` Hire the messenger for 2,000 shared gold - cost 2000 gold; 100%: NPC joins
- `e15_3` Take the messenger’s spare lamp - 100%: flag lamp
- `e15_4` Spend 20 seconds reading the letter, then collect the supplies - effect `careful`
- `e15_5` Leave it and keep going. - effect `leave`

### e16 Trade the Crates (trade, mixed)

Two crates were left on my cart. One’s sealed, one’s being watched. You can gamble on the first, pay for a safer look, or deal with the guards yourself.

- `e16_0` Take the sealed crate; it may contain bats **[rec]** - 50%: cave_parcel + 4000 cave gold | 50%: FIGHT 6x cave_bat
- `e16_1` Pay 3 Amber to open both crates - cost 3 Amber; 100%: cave_parcel
- `e16_2` Take the guarded crate - 100%: FIGHT 2x cave_npc
- `e16_3` Sell the empty crates for 1,500 cave gold - 100%: 1500 cave gold
- `e16_4` Take the loose hinges as a pry bar - 100%: flag tool
- `e16_5` Leave it and keep going. - effect `leave`

### e17 The Copying Shadow (shadow, mixed)

That dark patch copies the strongest fighter in your party. Step into it and the copy will step out. There’s a supply box behind it, naturally.

- `e17_0` Step into the shadow. Fight a copy of your strongest fighter. **[avoid]** - 100%: shadow copy fight
- `e17_1` Throw a stone into the shadow **[rec]** - 50%: cave_parcel | 50%: FIGHT 5x cave_bat
- `e17_2` Pay 2 Amber to keep the lamp burning - cost 2 Amber; 100%: cave_parcel
- `e17_3` Borrow the watcher’s lamp - 100%: flag lamp
- `e17_4` Watch the shadow for 20 seconds - effect `careful`
- `e17_5` Leave it and keep going. - effect `leave`

### e18 The Broken Lift (lift, mixed)

The lift’s stuck, and there’s a supply cage somewhere below us. Turn the wheel or pry open the service hatch. Something down there is moving.

- `e18_0` Turn the lift wheel hard **[rec]** - 50%: cave_rescue | 50%: FIGHT 8x cave_rat
- `e18_1` Hire the lift guard for 2,000 cave gold - cost 2000 gold; 100%: NPC joins
- `e18_2` Pry open the service hatch - needs tool; effect `use_tool`
- `e18_3` Sell the loose cable for 2 Amber - 100%: 2 Amber
- `e18_4` Call down to the lower landing - 100%: FIGHT 2x cave_wolf
- `e18_5` Leave it and keep going. - effect `leave`

Note: e18_2 instead if we carry a pry bar.

### e19 The Farmer’s Guess (mushroom, mixed)

I grow mushrooms for Amber. The plain patch is safe. The spotted patch pays better, though picking it may wake the bats.

- `e19_0` Pick the spotted patch; it may wake bats **[rec]** - 50%: cave_parcel + 3000 cave gold | 50%: FIGHT 6x cave_bat
- `e19_1` Pick the plain patch for 2 Amber - 100%: 2 Amber
- `e19_2` Plant a crop. Return after one minute for 3 Amber. - effect `plant`
- `e19_3` Borrow the farmer’s empty seed tin - 100%: flag decoy
- `e19_4` Clear the farmer’s rat pen - 100%: FIGHT 6x cave_rat
- `e19_5` Leave it and keep going. - effect `leave`

### e20 The Cornered Rogue (rogue, mixed)

Wolves have cornered a rogue with two daggers. You can help him, or wait and search his pack if they kill him. He keeps checking your position even while he fights.

- `save` Save {npc}: fight the wolves - effect `save`
- `watch` Wait; loot the pack if {npc} dies **[rec]** - effect `watch`
- `lure` Draw the wolves away from {npc} - effect `lure`
- `aid` Save and hire {npc} for 2,000 shared gold - cost 2000 gold; effect `hire`
- `finish` Attack {npc} and the wolves - effect `both`
- `cover` Bring {npc} behind us; take a smaller reward - effect `cover`

### e21 Change the Map (route, mixed)

I sell guard passes and mark supply rooms on maps. I know a shortcut too, though three guards have currently claimed it for themselves.

- `e21_0` Buy a pass for 3 shared Amber; skip one guardroom - cost 3 Amber; 100%: flag truce
- `e21_1` Take the guarded shortcut - 100%: FIGHT 3x cave_guard
- `e21_2` Trust the crossed-out route - 50%: cave_parcel | 50%: FIGHT 3x cave_wolf
- `e21_3` Hire the mapmaker for 2,000 cave gold - cost 2000 gold; 100%: NPC joins
- `e21_4` Take the spare lantern **[rec]** - 100%: flag lamp
- `e21_5` Leave it and keep going. - effect `leave`

Note: a free lamp, or leave if we hold one - 50 % on 3 wolves for half a parcel is not worth ~60 s (player review 2026-11-24).

### e22 One More Turn (pressure, mixed)

The chest is caught in this old machine. One more turn might free it, or you can bleed the pressure off slowly. The sentinel beside the pipes is asleep—for now.

- `e22_0` Give the wheel one more turn **[rec]** - 50%: cave_boss | 50%: FIGHT 1x cave_sentinel
- `e22_1` Release all the pressure at once - 100%: FIGHT 1x cave_lockbreaker
- `e22_2` Open the valve slowly: 20 seconds - effect `careful`
- `e22_3` Use a pry bar on the jammed latch - needs tool; effect `use_tool`
- `e22_4` Sell the loose fittings for 2 Amber - 100%: 2 Amber
- `e22_5` Leave it and keep going. - effect `leave`

Note: e22_3 instead if we carry a pry bar.

### e23 Keep the Crate Cold (escort, mixed)

Help me get this crate to the stairs and I’ll pay 3,000 cave gold and share my supplies when we arrive. Or we can open it here and see what all the ice is protecting.

- `e23_0` Escort the porter to the stairs - effect `escort`
- `e23_1` Open the crate before moving it **[rec]** - 50%: cave_rescue | 50%: FIGHT 4x cave_crab
- `e23_2` Pay 2,000 cave gold to unload it here - cost 2000 gold; 100%: cave_parcel
- `e23_3` Ask the porter to fight beside us - effect `guide`
- `e23_4` Take the spare lamp from the cart - 100%: flag lamp
- `e23_5` Leave it and keep going. - effect `leave`

### e24 The Same Prisoner Twice (twins, mixed)

{npc} and {rival} are dressed alike, and both insist they’re the prisoner you came to find. They’ve already drawn their weapons, which is not helping.

- `left` Help {npc} fight {rival} - effect `left`
- `right` Help {rival} fight {npc} - effect `right`
- `neither` Let them fight; collect what’s left - effect `neither`
- `both` Fight both and take the chest - effect `both`
- `peace` Pay 3,000 shared gold to stop the fight - cost 3000 gold; effect `peace`
- `testimony` Help whichever fighter hits harder **[rec]** - effect `testimony`

### e25 The Prisoner and the Captain (conflict, mixed)

{rival} wants {npc} back in chains. The prisoner says the captain sold out the last patrol. Neither seems interested in discussing it much longer.

- `left` Help {npc} fight {rival} - effect `left`
- `right` Help {rival} fight {npc} - effect `right`
- `neither` Let them fight; collect what’s left - effect `neither`
- `both` Fight both and take the chest - effect `both`
- `peace` Pay 3,000 shared gold to stop the fight - cost 3000 gold; effect `peace`
- `testimony` Help whichever fighter hits harder **[rec]** - effect `testimony`

### e26 The Toll Patrol (collapse, bad)

Three guards block the way. Their captain holds out a hand. “Pay the toll, or find out how serious we are.”

- `e26_0` Pay the 3,000 gold toll - cost 3000 gold; effect `pay`
- `e26_1` Fight the three guards - effect `bad_fight`
- `e26_2` Pay 2 shared Amber instead - cost 2 Amber; effect `pay`
- `e26_3` Pay 1,000 gold and spend 30 seconds getting past - cost 1000 gold; 30 s; effect `time`
- `e26_4` Wait for a way past; lose 45 seconds - 45 s; effect `time`
- `e26_5` Fight {npc} and six guards **[rec]** - effect `bad_double`

### e27 Stopped by a Guard (toll, bad)

The guard blocks your way. Apparently, passing through is a privilege with a price.

- `e27_0` Pay 3,000 shared gold to pass - cost 3000 gold; effect `pay`
- `e27_1` Fight the three guards - effect `bad_fight`
- `e27_2` Pay 2 shared Amber instead - cost 2 Amber; effect `pay`
- `e27_3` Pay 1,000 gold and spend 30 seconds getting past - cost 1000 gold; 30 s; effect `time`
- `e27_4` Wait for a way past; lose 45 seconds - 45 s; effect `time`
- `e27_5` Fight {npc} and six guards **[rec]** - effect `bad_double`

### e28 The Rope Snaps (alarm, bad)

The alarm rope has snapped, but the message got through. Guards are coming, and the bell keeper seems willing to reconsider—for a price.

- `e28_0` Pay 3,000 shared gold to stop the alarm - cost 3000 gold; effect `pay`
- `e28_1` Fight the three guards - effect `bad_fight`
- `e28_2` Pay 2 shared Amber instead - cost 2 Amber; effect `pay`
- `e28_3` Pay 1,000 gold and spend 30 seconds getting past - cost 1000 gold; 30 s; effect `time`
- `e28_4` Wait for a way past; lose 45 seconds - 45 s; effect `time`
- `e28_5` Fight {npc} and six guards **[rec]** - effect `bad_double`

### e29 The Cargo Is Stuck (cargo, bad)

A loaded cart is wedged in the passage. Its guards could move it, but first they'd like to be paid for the inconvenience.

- `e29_0` Pay 3,000 shared gold to move the cart - cost 3000 gold; effect `pay`
- `e29_1` Fight the three guards - effect `bad_fight`
- `e29_2` Pay 2 shared Amber instead - cost 2 Amber; effect `pay`
- `e29_3` Pay 1,000 gold and spend 30 seconds getting past - cost 1000 gold; 30 s; effect `time`
- `e29_4` Wait for a way past; lose 45 seconds - 45 s; effect `time`
- `e29_5` Fight {npc} and six guards **[rec]** - effect `bad_double`

### e30 The Wrong Receipt (debt, bad)

The collector insists you're carrying a debtor's receipt. He can be paid off, fought, or given time to discover that names are worth reading.

- `e30_0` Pay 3,000 shared gold to settle the debt - cost 3000 gold; effect `pay`
- `e30_1` Fight the three guards - effect `bad_fight`
- `e30_2` Pay 2 shared Amber instead - cost 2 Amber; effect `pay`
- `e30_3` Pay 1,000 gold and spend 30 seconds getting past - cost 1000 gold; 30 s; effect `time`
- `e30_4` Wait for a way past; lose 45 seconds - 45 s; effect `time`
- `e30_5` Fight {npc} and six guards **[rec]** - effect `bad_double`

### e31 The Shop with One Item (merchant, positive)

I've got exactly one item for sale. Have a look. It costs cave gold, and if you buy it, one random member of the party you entered with gets it.

- `e31_0` Open the shop **[rec]** - effect `inspect`
- `e31_1` Keep our gold and move on - effect `leave`
- `e31_2` Ask where the item came from - effect `story`
- `e31_3` Check the price and the item - effect `inspect`
- `e31_4` We don't need it - effect `leave`
- `e31_5` Leave it for another day - effect `leave`

### e32 Clear the Crab Pens (hunt, positive)

The crabs keep breaking out of their pens. Clear the marked ones before time runs out, and I’ll make it worth your while.

- `e32_0` Kill 6 crabs in 90s for supplies, 5,000 gold and 2 Amber - effect `hunt`
- `e32_1` Kill 12 crabs in 90s for twice the supplies **[rec]** - effect `hunt_double`
- `e32_2` Kill 3 crabs in 90s for 2 Amber - effect `hunt_quick`
- `e32_3` Take a helper: 6 crabs in 90s - effect `hunt_helper`
- `e32_4` Take 120s to kill 6 crabs; earn 2 Amber - effect `hunt_late`
- `e32_5` Skip this hunt - effect `leave`

Note: double only if the crabs are close.

### e33 Catch the Bats (hunt_bats, positive)

The bats stole my keys again. Clear the marked ones before time runs out, and I’ll give you something for the trouble.

- `e33_0` Kill 8 bats in 75s for supplies, 5,000 gold and 2 Amber - effect `hunt`
- `e33_1` Kill 16 bats in 75s for twice the supplies **[rec]** - effect `hunt_double`
- `e33_2` Kill 4 bats in 75s for 2 Amber - effect `hunt_quick`
- `e33_3` Take a helper: 8 bats in 75s - effect `hunt_helper`
- `e33_4` Take 105s to kill 8 bats; earn 2 Amber - effect `hunt_late`
- `e33_5` Skip this hunt - effect `leave`

Note: double only if the bats are close.

### e34 Rats with Silver Teeth (hunt_rats, positive)

The rats are chewing through my stock. Clear the marked ones before time runs out, and I’ll pay you.

- `e34_0` Kill 10 rats in 60s for supplies, 5,000 gold and 2 Amber - effect `hunt`
- `e34_1` Kill 20 rats in 60s for twice the supplies **[rec]** - effect `hunt_double`
- `e34_2` Kill 5 rats in 60s for 2 Amber - effect `hunt_quick`
- `e34_3` Take a helper: 10 rats in 60s - effect `hunt_helper`
- `e34_4` Take 90s to kill 10 rats; earn 2 Amber - effect `hunt_late`
- `e34_5` Skip this hunt - effect `leave`

### e35 Move the Caravan (escort_safe, positive)

I lost the rest of my caravan. Get me to the stairs and I’ll pay 3,000 cave gold and share my supplies. I can carry a weapon if you’d rather have the extra help.

- `e35_0` Walk {npc} to the stairs for a reward **[rec]** - effect `escort`
- `e35_1` Ask {npc} to join us as a fighter - effect `guide`
- `e35_2` Borrow a lamp for the walk - 100%: flag lamp
- `e35_3` Ask for a pry bar for the locked hatches - 100%: flag tool
- `e35_4` Take 1 Amber instead of escorting - 100%: 1 Amber
- `e35_5` Sorry. We can’t take you with us. - effect `leave`

### e36 Craft with Cave Amber (recipes, positive)

Cole can turn Cave Amber into equipment. I have his recipes and a few spare materials. What would be useful?

- `e36_0` Show Cole’s recipes - effect `recipes`
- `e36_1` Take a sample: 1 Amber **[rec]** - 100%: 1 Amber
- `e36_2` Borrow a pry bar to find more supplies - 100%: flag tool
- `e36_3` Borrow the spare lamp - 100%: flag lamp
- `e36_4` Ask the smith’s helper to join us - 100%: ally cave_npc
- `e36_5` We’ll visit Cole later - effect `leave`

### e37 Try the Dice (practice_dice, positive)

Want a free roll? Roll a six and the party gets a chest with 1 Amber. No bet this time.

- `e37_0` Roll for free; a six wins 1 Amber **[rec]** - effect `free_die`
- `e37_1` Ask how the Loaded Die works - effect `story`
- `e37_2` Ask the dealer to roll for us - effect `free_die`
- `e37_3` Ask the dealer to come along instead - 100%: NPC joins
- `e37_4` Save the game for later - effect `leave`
- `e37_5` No thanks. We don’t want to roll - effect `leave`

### e38 Borrow a Tool (tool, positive)

Take what you need from my tool bag. The pry bar opens locked hatches, the lamp helps with moths, and the tin rattle can draw a patrol away.

- `e38_0` Take a pry bar for locked hatches **[rec]** - effect `tool`
- `e38_1` Take a lamp for the moths - effect `lamp`
- `e38_2` Take the tin rattle - effect `decoy`
- `e38_3` Ask the cartographer to come with us - 100%: NPC joins
- `e38_4` Trade the scrap for 1 Amber - 100%: 1 Amber
- `e38_5` We have what we need. - effect `leave`

Note: floor 1 without a tool the pry bar; later or with a tool 1 Amber (e38_4).

### e39 The Amber Garden (plant, positive)

These seeds grow Amber in one minute. Plant them, explore if you like, then come back and open the chest for 3 Amber.

- `e39_0` Plant a crop; collect 3 Amber after one minute **[rec]** - effect `plant`
- `e39_1` Take 1 Amber now instead - 100%: 1 Amber
- `e39_2` Take the farmer’s spare rattle - effect `decoy`
- `e39_3` Ask the farmhand to join us - 100%: ally cave_npc
- `e39_4` Borrow the farmer’s spare lamp - effect `lamp`
- `e39_5` Leave the seeds with the farmer. - effect `leave`

Note: only if we pass the room again after 1 min, else e39_1.

### e40 Practice with Wooden Swords (practice, positive)

Want to spar? Beat me before the timer runs out and you win a prize. I stop at 1 HP, and my blows cannot kill you.

- `e40_0` Try the 30-second fight for a supply prize **[rec]** - effect `practice`
- `e40_1` Try an easier fight for 1 Amber - guard 0.5; reward 1 Amber; effect `practice`
- `e40_2` Win within 15 seconds for a supply prize - 15 s; effect `practice`
- `e40_3` Ask {npc} to fight beside us instead - effect `guide`
- `e40_4` Take a 20-second lesson and the trainer’s supplies - effect `careful`
- `e40_5` No thanks. We do not want to spar. - effect `leave`

Note: e40_2 (15 s) once we know the trainer is weak.

### e41 Trade Materials (exchange, positive)

I will trade you my supply box for 2 Amber from the shared purse. If not, you can take one of the smaller things instead.

- `e41_0` Trade 2 shared Amber for the supply box - cost 2 Amber; effect `exchange`
- `e41_1` Borrow a pry bar instead - effect `tool`
- `e41_2` Take the trader’s spare lamp - effect `lamp`
- `e41_3` Take a tin rattle for the road - effect `decoy`
- `e41_4` Ask the trader’s guard to join us **[rec]** - 100%: ally cave_npc
- `e41_5` Keep our Amber. - effect `leave`

### e42 The Rat’s Shortcuts (ratdoor, positive)

My rat keeps finding rooms the guards missed. I can mark them on your map, or you can let the rat tag along.

- `e42_0` Mark the rooms the rat found - effect `reveal`
- `e42_1` Let the rat follow us - 100%: ally cave_rat
- `e42_2` Borrow a lamp to check the wall - effect `lamp`
- `e42_3` Take the pry bar by the rat’s hole - effect `tool`
- `e42_4` Take the Amber the rat brought back **[rec]** - 100%: 1 Amber
- `e42_5` Leave the rat with its keeper. - effect `leave`

### e43 Call a Guard Away (decoy, positive)

I used to lead those guards. Some of them might still listen to me. I can help you past their camp, or come along myself.

- `e43_0` Take a message for a guard **[rec]** - effect `decoy`
- `e43_1` Ask {npc} to fight beside us - effect `guide`
- `e43_2` Ask where the other travelers are - effect `reveal`
- `e43_3` Borrow {npc}’s spare lamp - effect `lamp`
- `e43_4` Borrow {npc}’s pry bar - effect `tool`
- `e43_5` We will deal with the guards ourselves. - effect `leave`

### e44 Find the Rogue (appraise, positive)

Looking for the rogue? I can mark where I saw him. Before you decide whether to help, check both of his daggers.

- `e44_0` Mark where the rogue was seen **[rec]** - effect `appraise`
- `e44_1` Explain how to spot the rare dagger - effect `story`
- `e44_2` Ask {npc} to join us - effect `guide`
- `e44_3` Borrow a lamp to see the blades - effect `lamp`
- `e44_4` Take a sample of the local Amber - 100%: 1 Amber
- `e44_5` We will look for him ourselves. - effect `leave`

### e45 The Lost Traveler (escort_safe, positive)

I cannot find the stairs. Get me there and I will pay 3,000 cave gold and share whatever supplies I have left.

- `e45_0` Walk {npc} to the stairs for a reward **[rec]** - effect `escort`
- `e45_1` Ask {npc} to join us as a fighter - effect `guide`
- `e45_2` Borrow a lamp for the walk - 100%: flag lamp
- `e45_3` Ask for a pry bar for the locked hatches - 100%: flag tool
- `e45_4` Take 1 Amber instead of escorting - 100%: 1 Amber
- `e45_5` Sorry. We cannot take you with us. - effect `leave`

### e46 Is It Worth the Price? (merchant, positive)

This came from a shop that closed years ago, and I have one copy left. Pay with the party’s cave gold; one random member of your original party gets it.

- `e46_0` Open the shop **[rec]** - effect `inspect`
- `e46_1` Keep our gold and move on. - effect `leave`
- `e46_2` Ask where the item came from - effect `story`
- `e46_3` Check the price and the item - effect `inspect`
- `e46_4` We do not need it. - effect `leave`
- `e46_5` Leave it for another day. - effect `leave`

### e47 Follow the Thread (moths, positive)

The moths gathered around a pair of boots in the wall. A steady lamp will draw them off. Without one, I can only gather some Amber for you.

- `e47_0` Use our lamp to uncover the boots **[rec]** - effect `moths`
- `e47_1` Take 2 Amber without disturbing the moths - 100%: 2 Amber
- `e47_2` Borrow a lamp for another moth nest - effect `lamp`
- `e47_3` Ask the moth keeper to follow us - 100%: NPC joins
- `e47_4` Mark the nearby rooms on our map - effect `reveal`
- `e47_5` Leave the moths alone. - effect `leave`

Note: needs a lamp, else e47_1 (2 Amber).

### e48 The Supply Cart (merchant, positive)

I keep a few supplies for travelers. There is one item left today, and I take cave gold from the shared purse.

- `e48_0` See the item and its price **[rec]** - effect `inspect`
- `e48_1` Ask what happens to leftover cave gold - effect `story`
- `e48_2` Ask where other merchants wait - effect `story`
- `e48_3` Borrow a lamp for the return trip - effect `lamp`
- `e48_4` Take a pry bar from the supply cart - effect `tool`
- `e48_5` Keep the gold in the shared purse. - effect `leave`

### e49 Make a Tool (tool, positive)

I can turn these hinges into a pry bar, or refill a lamp. Pick one, and it is yours for the rest of this visit.

- `e49_0` Take a pry bar for locked hatches **[rec]** - effect `tool`
- `e49_1` Take a lamp for the moths - effect `lamp`
- `e49_2` Take the tin rattle - effect `decoy`
- `e49_3` Ask the toolmaker to come with us - 100%: NPC joins
- `e49_4` Trade the scrap for 1 Amber - 100%: 1 Amber
- `e49_5` We have what we need. - effect `leave`

Note: floor 1 without a tool the pry bar; later or with a tool 1 Amber (e49_4).

### e50 Before You Leave (farewell, positive)

Take one gift before you go: 2 Amber, something from my supply box, or a spare tool. One choice, so make it count.

- `e50_0` Take 2 Amber **[rec]** - effect `gift`
- `e50_1` Open the little supply box - 100%: cave_parcel
- `e50_2` Take a spare lamp - effect `lamp`
- `e50_3` Take a spare pry bar - effect `tool`
- `e50_4` Ask {npc} to stay with us - effect `guide`
- `e50_5` Thanks. We have enough. - effect `leave`
