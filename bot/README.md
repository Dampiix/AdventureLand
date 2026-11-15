# Bot v1

One bot for every character. The leader runs `bot_main` in the game client and starts the
other characters of the current phase as CODE-only characters in the same client.
Each character looks itself up in `config.js` and loads its role.

## Starting from scratch

To run the bot with a new team (e.g. three new level-1 characters and a merchant), create the
characters in the game, put their names into `team` in `config.js` and run `bot_main` on the leader.
Everything else adapts: the progression guide picks targets and gear for each level, potions
start small (`hpot0`/`mpot0`) and switch to big ones as the pools grow, fighters keep level x 5k gold,
the merchant never spends below 20 % of its own gold, and events wait until every fighter reaches
`events.minLevel` (Phoenix 40, Goo Brawl 20, Snowman 10). Classes without a skill module (warrior,
rogue) fight with basic attacks.

## Starting

1. On the leader (`DmpxPalTank`), load CODE slot **20 `bot_main`** and press **Run**.
2. The leader starts everyone listed in `phases[phase].startWithLeader`
   (solo phase: only the merchant).
3. **Stop** on the leader stops the leader's bot. CODE-only characters keep running until
   they are stopped too (`/stop NAME` or the character's CODE window).

## Layout

| File | Slot | Purpose |
|---|---|---|
| `main.js` | 20 `bot_main` | entry point, role lookup, starts the team |
| `config.js` | 21 `bot_config` | characters, phase, thresholds, sell list |
| `lib/util.js` | 22 `bot_util` | stateless helpers |
| `lib/comms.js` | 23 `bot_comms` | CODE messages between own characters (trusted senders only) |
| `core/targeting.js` | 24 `bot_targeting` | farm target (config override → hunt → progression guide → fallback), crowded-spot fallback to the guide's next choice, target picking |
| `core/supply.js` | 25 `bot_supply` | fighter side: hand loot/gold to the merchant, request pickups, buy potions if the merchant is silent |
| `core/fighter.js` | 26 `bot_fighter` | main loop for fighters |
| `classes/paladin.js` | 27 `bot_class_paladin` | self-heal, Smash |
| `classes/mage.js` | 28 `bot_class_mage` | basic attacks for now |
| `classes/priest.js` | 29 `bot_class_priest` | self-heal, heal the most hurt party member, Party Heal, Curse |
| `classes/ranger.js` | 36 `bot_class_ranger` | Hunter's Mark, Supershot, 3-Shot |
| `roles/merchant.js` | 30 `bot_merchant` | sells junk, keeps a potion stock, delivers to fighters |
| `core/party.js` | 31 `bot_party` | party invites/accept/leave, leader broadcast, following |
| `core/hunts.js` | 32 `bot_hunts` | Monster Hunts: pick a safe hunt of any party fighter, Daisy trips, turn in |
| `core/gear.js` | 33 `bot_gear` | fighter: equipment wishes from the progression guide, equips the guide's upgrades |
| `core/events.js` | 35 `bot_events` | live events and world bosses: join events, travel to bosses, search the Phoenix |
| `roles/workshop.js` | 34 `bot_workshop` | merchant: fulfils wishes from bag, bank, upgrades or compounds; combines spare accessories |

## Phases and the party

`config.phase` selects who runs:

- `solo` – the leader farms alone (Lone Wolf bonus) and starts only the merchant.
- `party` – the leader also starts the mage and priest. The leader invites them, members accept
  invites from the leader only and leave any other party. Every 2 s the leader broadcasts its
  position, farm target and current target. Members:
  - follow the leader (catch up beyond `party.leash`, idle within `party.followDistance`),
  - attack monsters that attack a party member, otherwise assist the leader's target,
  - never pull new monsters themselves, so the tank keeps the aggro.

Class behaviour in a party: Priest Party Heal (2+ members hurt or one in danger) and Curse on
sturdy targets; Mage Energize to members low on MP; Paladin Guardian's Oath (level 50) on hurt allies.

`slots.json` holds the same mapping. Modules load each other by slot **name** with
`require_code()`. Only `main.js` calls `require_code()`; every other module is a factory
that receives its dependencies (`ctx`), so nothing is evaluated twice.

## Monster hunts

Members report their hunt to the leader. The leader farms the hunt monster of any fighter that is
on this server, has kills left and is safe according to the progression guide (`config.hunts.allow`
/ `deny` override this); the hunt expiring first wins. When a hunt is finished, or someone has none
and nothing is huntable, the leader walks the group to Daisy (at most every 10 minutes) and every
fighter turns in / takes a hunt there. Unsafe hunts are left to expire.

## Events and world bosses

The leader reads `server.status` and logs which events are live. `config.events.policy` decides per
event (`always` / `never`): join events (Goo Brawl, ...) are joined by every fighter, world bosses with
a reported position (Snowman) are travelled to, roaming bosses listed in `events.search` (Phoenix) are
searched across their spawn areas every 10 minutes and engaged whenever one shows up. Events beat
hunts, hunts beat farming; no Daisy trips during events. Cooperative monsters may be attacked while
they fight other players, because every contributor is rewarded.

## Equipment (workshop)

Every 5 minutes each fighter sends up to three equipment wishes from its progression guide
(e.g. "mace +4") to the merchant. The merchant fulfils one wish at a time: a copy already in its
bag, a copy in the bank, or it develops its own copy (bank or +0 from an NPC) at Cue. Rules
(`config.workshop`): every step is previewed; the required chance depends on what is at risk
(`workshop.risk`: cheap re-buyable copies 40 %, mid-value 60 %, precious or irreplaceable 70 %), and a
higher scroll grade (owned, banked, or bought within budget) is tried when the normal one falls short; never below
the gold reserve, at most **500k per wish**, no offerings or shells. Compound items (rings,
earrings, books) are built from three matching copies per level out of bag and bank; without open
wishes the merchant also combines spare copies up to `workshop.compound.autoUpTo` (same 70 % rule),
and then exchanges Armor Boxes, gems and seashells (`workshop.exchange.items`) in batches of 10 while
at least 8 bag slots are free. Rewards go through the normal sell / bank / compound / wish rules. Before a mid-value or precious item is risked at +4 or higher with too low a chance, the merchant
builds **grace**: it fails cheap shop helmets at that level (the player's grace per level rises on
failures and resets on success) until the real preview reaches the tier, within 300k per level per
day (`workshop.grace`). Leftover fodder is sold. Items no NPC sells are bought with tokens (e.g. the
Concord Mace for 12 Monster Tokens at Daisy). `workshop.wishes` adds fixed wishes on top of the guide's.
If the next upgrade step is below 70 %, the copy is delivered at the level reached. A delivered wish
is not fulfilled again for 6 hours. Finished items go out on the next
delivery; the fighter follows its guide's "equip" advice and hands the old piece back.

## Merchant flow

```
fighter low on potions / bag filling up / every 15 min
  └─ CM "pickup" {map, x, y, want}  ──►  merchant answers CM "coming"
                                         restocks, walks to the fighter
                                         sends potions, casts Merchant's Luck
fighter sees the merchant nearby ──► sends loot + gold above goldKeep
                                         merchant waits 10 s, walks back to town
                                         sells sellList items (never +1 or better, shiny, locked)
```

If the merchant does not answer for 3 minutes and potions drop below `selfBuyBelow`,
the fighter walks to town and buys them itself.

## Deploying

Repo files are the source of truth. Upload changed files into their slots with

```bash
node scripts/deploy-bot.mjs            # only files that differ from the slot
node scripts/deploy-bot.mjs --dry-run  # show what would change
node scripts/deploy-bot.mjs --all      # upload everything
```

The script uses the Adventure Land JSON API with the token from `ADVENTURELAND_TOKEN`.
Saving a slot does not change running CODE: restart `bot_main` on the leader afterwards
(CODE-only characters keep their old code until they are restarted too).
