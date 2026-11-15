# Bot v1

One bot for every character. The leader runs `bot_main` in the game client and starts the
other characters of the current phase as CODE-only characters in the same client.
Each character looks itself up in `config.js` and loads its role.

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
| `core/targeting.js` | 24 `bot_targeting` | farm target (config override → progression guide → fallback) and target picking |
| `core/supply.js` | 25 `bot_supply` | fighter side: hand loot/gold to the merchant, request pickups, buy potions if the merchant is silent |
| `core/fighter.js` | 26 `bot_fighter` | main loop for fighters |
| `classes/paladin.js` | 27 `bot_class_paladin` | self-heal, Smash |
| `classes/mage.js` | 28 `bot_class_mage` | basic attacks for now |
| `classes/priest.js` | 29 `bot_class_priest` | self-heal, heal the most hurt party member |
| `roles/merchant.js` | 30 `bot_merchant` | sells junk, keeps a potion stock, delivers to fighters |

`slots.json` holds the same mapping. Modules load each other by slot **name** with
`require_code()`. Only `main.js` calls `require_code()`; every other module is a factory
that receives its dependencies (`ctx`), so nothing is evaluated twice.

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

Repo files are the source of truth. After changing a file, save it into its slot
(currently done through the Adventure Land MCP `save_code` tool) and restart the bot.
Saving a slot does not change running CODE.
