# earthiverse's bot vs ours (2026-11-20)

Source read: `earthiverse/adventureland-bots` (master) and `earthiverse/ALClient` (his headless client library), compared
with our `bot/` at v1.156.3. Read-only review in four areas (movement, combat, merchant, orchestration).
His bots run headless in Node (ALClient); ours run as browser CODE in the Steam client. "Portable" means the idea can be
built in browser CODE. Effort: S (hours), M (a day), L (more).

His cross-server features (server hopping by monster/Ponty, "recently seen" bosses, deal finder) read his own MongoDB,
filled by his bots, observer sockets on every server and characters he hosts for others. We want our own solution
(player decision 2026-11-20), so those parts are listed only as ideas.

## Top candidates (expected gain first)

| # | Idea | Area | Effort |
|---|------|------|--------|
| 1 | Attack/heal loop driven by the skill cooldown (setTimeout(ms_to_next_skill), reduce_cooldown by ping) instead of the 250 ms tick | combat | M |
| 2 | Never stop healing/defending while "busy": tick returns before cls.support()/handleCombat() during waitForTeam, supply, events, hunts, keepUp, leaderTravels | combat | S-M |
| 3 | Cost-optimal scroll AND offering per upgrade/compound step (Dijkstra over level x grace, cost = (item value + scroll + offering) / chance); we never use offerings | merchant | M |
| 4 | Primling stacking: offering without scroll adds +0.5 item grace (+1 with a stat scroll) without risking the item; works on high/rare grades where our fodder grace failed | merchant | S-M |
| 5 | Respawn-aware boss search: after a watched kill search again at kill + respawn x 0.72 (long respawns come up to 28 % early) instead of a flat 30 min | meta | S |
| 6 | Travel-time route costs (walk = distance/speed, door 0.8 s, transporter 3.2 s, town 3.8 s) to pick the nearest spawn/NPC/boss area | movement | S-M |
| 7 | Rare monsters (golden bat, cutebee, snowman, wabbit, tinyp...) jump to the top of the target list when visible; per-farm "bonus" types | meta | S |
| 8 | Member watchdog: restart a member whose CODE/window died (heartbeat from existing comms reports) | meta | S-M |
| 9 | Overkill prevention: skip targets that projectiles in flight will kill; announce one-shots so teammates pick others | combat | M |
| 10 | Mluck uptime: self, own fighters under 50 % duration, and any player near the stand | merchant | S |

## Movement and pathfinding

His pathfinder (ALClient) is now a WASM package (`alpathfinder`); visible are its API and cost model:
- Built once at start-up for all connected maps (doors, transporters); queries `isWalkable`, `canWalkPath`,
  `getSafeWalkTo`, `getPath(from, to, {speed, avoidMaps})` returning move/door/transport/town/enter/leave nodes.
- Costs in seconds (see #6); several destinations are each routed and the cheapest wins.
- smartMove executes the path with straight-line shortcuts, stops `getWithin` px short (NPC 200 px, monsters range - margin),
  walks while the Town teleport channels, retries up to 3x with a new path, and shortens blocked moves to the furthest safe point.

The game's smart_move: no cost weights, no caching, search spread over frames (slow on long routes), Town counts as one step
(why we needed the use_town hack in main.js).

Recommendation, in steps:
1. Measure first: log smart_move search time vs walk time and calls per hour (hot spots: xmove re-issues in fighter.js moveTo,
   member follow, searchBoss).
2. Inter-map graph with his costs (doors, transporters, spawn[0]; in-map walking = distance/speed) for spotFor, the order of
   boss search areas and merchant trips. Walking still via smart_move. S-M.
3. Stand/visibility check via parent.can_move: getWithin stops, Dash landing check (warrior Dash is off because landings
   failed), party offsets so members don't stand on the leader's pixel. S.
4. Own per-map corner-node graph only if step 1 shows the search time matters (M-L); never a 1-px grid per map
   (4 characters in one client).

Also: members follow with a fresh smart_move only when the leader moved > ~150 px or changed map (like merchant catchUp).

## Combat, targeting, party

Do not copy: "warp to jail" (move(100000,100000)) as death escape - exploit-like.

Beyond #1, #2, #9:
- Free-cooldown skills on every cooldown: Supershot whenever ready (ours only on hp > 3x attack), Cleave even on one target
  unless a basic attack kills it, zapperzap when MP is near full (config plans a zapper ring, nothing casts it).
- Courage (fear) gate before every pull with any attack, per damage type (ours only for Agitate).
- Weapon swap for Cleave/Stomp (offhand off, axe/basher on, skill, back) - our dual-wield warrior can never cast them.
- Predictive death check: sum of max damage of attackers in range (+20 % each beyond courage), also projectiles in flight -
  as a trigger for potion/Taunt/kite/stop pulling.
- Step away when a hit event reports us as `stacked`.
- Fighters below 50 % walk into the priest's range; the priest walks to a friend below 50 %.
- Party Heal from comms-reported HP (our priest only sees visible members).
- Later (level 60): 3-shot candidate rule (also free monsters it can one-shot), Hard Shell when 3x incoming burst >= HP.
- Target sort tie-breakers: "won't die to projectiles", "far from teammates" (spreads members over a pack).

Ours is ahead in: team safety model, death memory and analysis, lone pulls/isolation, crowded/occupied spots, adaptive Agitate,
generic kiting with corner escape, spacing, dreturn avoidance, waitForTeam, chest opener, DPS meter.

## Merchant and economy

Beyond #3, #4, #10:
- Sell into other players' buy orders / buy from their stands at or below our price (needs parent.entities[merchant].slots).
- Join giveaways (stand slots with giveaway:true) - free items, ~10 lines.
- Mining (pickaxe exists, mining off because of the moles).
- Small: profit crafting (cake, carrotsword to NPC, Wanderer pieces from crab claws/slime/spores), broom while walking,
  elixir/booster upkeep, config price sanity check (no buy above NPC price, no sell below NPC value), shorter Ponty polling
  when Ponty is next to the stand, bank stack tidying.
- His upgrade rule is inventory-driven (upgrade spare copies beyond what everyone can equip); ours is goal-driven (wishes,
  team-wide stages, ladder) - ours fits progression better.

Ours is ahead in: budget pots from measured income, value report (% power per gold/hour), wish buy orders at own cost with
fill detection, Ponty finds by gain per gold, dismantling and essence goals, team stages, crafting from stock with shortage
reports, token shop, tracker delivery.

## Orchestration and meta

Beyond #5, #7, #8:
- Invulnerable bosses: skip while `s.fullguard` (snowman) - we would stand at a boss we cannot damage.
- Seasonal buffs: holiday spirit (visit newyear_tree once per character), anniversary kiss.
- Achievement targets from the tracker: farm the monster with the smallest (points to next threshold) x HP. Progress counts the
  account's best character; party kills credit every member.
- Per-character jobs: one character peels off (golden bat, Daisy turn-in, boss search spots split across characters) while the
  others keep farming - cuts downtime, costs group safety.
- Call-cost guard (skip optional calls while character.cc > 100).
- Runtime commands (/farm X, /events off) instead of config edit + reload.
- Small: set_home, Jacko scare on Daisy trips, temporal surge near boss respawns, crypt/tomb instances (late game).

Ours is ahead in: guide-based farm choice with team model and experience, boss feasibility check, hunt safety/time-fit, drop
routes, own gold measurement, cavalry, persisted timers, no external database.
