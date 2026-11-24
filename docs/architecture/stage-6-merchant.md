# Stage 6: workshop and merchant into their parts (plan, 2026-11-24)

Status: **plan, not built.** Same branch (`modular-pilot`), **no change in behaviour**. Step 6 of the module plan.

## Where we are

| File | Lines | Functions | Uses from ctx |
|---|---|---|---|
| `roles/workshop.js` (slot `bot_workshop`) | 4,282 | 204 | config, util, comms |
| `roles/merchant.js` (slot `bot_merchant`) | 1,375 | 63 | config, util, comms, workshop, scout |
| `roles/scout.js` (slot `bot_scout`) | 419 | 18 | config, util, comms |

The merchant is the only role that spends gold, upgrades, compounds, exchanges and sells - a mistake here costs items,
not just time. So the same method as stages 4b/4c/5 (every function moved verbatim by a generator, a mechanical check,
old vs new tests in a fake game), and the merchant is reloaded only between trips.

## Method

As before: the parts share one internal state object (`wks` for the workshop, `mer` for the merchant - both unused in
the files today) and call each other through it; outside dependencies come as deps; the facade keeps the state and the
start-up statements in the old order and the same interface. The facades stay in their slots; the files move to
`roles/workshop/` and `roles/merchant/` (the module plan's layout).

### 6a. Workshop (`roles/workshop/`, 26 sections -> 15 parts + facade)

| Part | Sections (functions) |
|---|---|
| `common.js` | the helpers before the first section: team and online checks, NPC positions, walking to an NPC, boost, bag index, main stat (18) |
| `wishes.js` | the fighters' wishes and deliveries: wish list, delivered marks, earmarks, delivery, the merchant's own wishes, drop shortages (21) |
| `bank.js` | bank, develop (one wish: bag -> bank -> upgrade) (9) |
| `budget.js` | income-based budget for gear goals, risk tiers (12) |
| `crafting.js` | crafting (8) |
| `compound.js` | compound (4) |
| `dismantle.js` | dismantling (4) |
| `material-goals.js` | material goals (20) |
| `exchange.js` | exchange, elixirs from the exchange, token shops (10) |
| `grace.js` | grace (9) |
| `gear-goals.js` | gear goals, empty slots (10) |
| `off-plan-armor.js` | off-plan armor (24) |
| `better-weapons.js` | better weapons (drops) (8) |
| `scrolls.js` | value report, scroll choice (14) |
| `ponty.js` | Ponty, other players' stands (21) |
| facade `workshop.js` | one per character, the main step (12) |

### 6b. Merchant (`roles/merchant/`, 6 sections -> 6 parts + facade) and the scout

| Part | Sections (functions) |
|---|---|
| `stand.js` | market stand (6) |
| `fishing.js` | fishing (16) |
| `elixirs.js` | elixirs (14) |
| `ponty-round.js` | the Ponty round over other servers (8) |
| `sell-to.js` | selling into other players' buy orders, buying from their stands (15) |
| `mluck.js` | Merchant's Luck for everyone in reach (2) |
| facade `merchant.js` | the merchant's tick, survive, canSupply (2 + the tick) |

`roles/scout.js` (419 lines) moves to `roles/merchant/scout.js` with explicit deps; it is small enough to stay one file.

## Checks

- `scripts/check-split.cjs` for both (every function identical with the prefix removed, statement order kept).
- `scripts/test-workshop.cjs` (new): old vs new main step in the fake game with the real G and config, fake bank and
  NPCs; every buy, upgrade, compound, exchange, bank move, sale, comms message and log line is recorded. Scenarios: a
  fighter's wish (bag / bank / develop), a compound with three copies, a dismantle, a material goal, an exchange,
  Ponty with listings, a delivery, gear goals with a budget.
- `scripts/test-merchant.cjs` (new): old vs new merchant tick: the stand (buy and sell orders), fishing, elixirs, a
  Ponty round start, a sell-to trip start, Merchant's Luck.
- Live: deploy; reload the merchant only with `bot_trade_trip` and `bot_ponty_round` null and an empty queue; watch one
  bank trip, the stand, a workshop step, a Ponty round.

## Order

1. 6a workshop; checks + test; deploy; reload the merchant (between trips); watch a workshop step and a bank trip.
2. 6b merchant + scout; checks + test; deploy; reload between trips; watch the stand, a Ponty round, a boss search.

## Not in stage 6

`core/gear.js` (1,006 lines: equip, wishes, luck swap, value) and `core/supply.js` / `core/drops.js` keep ctx for now -
they get explicit deps with stage 7 (per-module defaults), together with the remaining `ctx` users.
