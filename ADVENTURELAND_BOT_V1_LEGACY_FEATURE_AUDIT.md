# AdventureLand Bot V1 — Legacy Feature Audit

## Purpose

This document captures the complete functional audit of the legacy AdventureLand Bot V1 codebase.

V1 is treated as a **legacy reference and behavioral specification**, not as the codebase for V2.

The V2 plan is:

1. Inventory and classify all V1 capabilities.
2. Build V2 as a complete rewrite with a clean architecture.
3. Reach functional feature parity with the stable V1 capabilities.
4. Retire V1.
5. Review the current Adventure Land documentation and game systems.
6. Expand V2 beyond V1 with new capabilities and improved behavior.

Classification used throughout this audit:

- **KEEP** — The capability should exist in V2.
- **IMPROVE** — Keep the capability, but improve its behavior or design.
- **RETHINK** — Keep the goal, but redesign the implementation substantially.
- **DROP** — Do not carry the implementation/feature into V2.
- **INCOMPLETE** — V1 contains a partial or experimental implementation.

---

## 1. Overall Architecture

V1 consists of seven JavaScript modules:

```text
init
├─ lists
└─ main
   ├─ priest
   └─ auto-merchant
      └─ upgrade_compound

exchange
```

`exchange` is structurally mostly independent from the rest of the bot.

The overall architecture is based on:

- Multiple `setInterval()` loops
- Global variables
- Globally available functions
- Shared lists/settings
- A global state machine per character
- An additional merchant state machine
- Direct access to Adventure Land browser objects
- Partial direct access to other character iframes

---

## 2. Character Setup

### Multi-Character Startup

**Status: KEEP**

The Warrior acts as the bootstrap character.

When `DampiixWar` starts `init`, it automatically starts:

```text
Dampiiix
DampiixPri
DampiixMerch
```

using `main`.

V1 party:

```text
DampiixWar   → Warrior
Dampiiix     → Mage
DampiixPri   → Priest
DampiixMerch → Merchant
```

### V2 Requirement

One character should be able to act as the orchestrator and automatically start the other configured characters.

Character names and roles must be defined through explicit configuration rather than being scattered through bot logic.

---

## 3. Configuration

### Central Party Configuration

**Status: KEEP / IMPROVE**

`lists.js` contains the party members centrally.

Positive:

- Character list exists in one place.

Problems:

- Array order has hidden meaning.
- `party_list[0]` means Tank.
- `party_list[3]` means Merchant.

### V2 Requirement

Use explicit role configuration, for example:

```js
characters = {
    tank: "...",
    mage: "...",
    priest: "...",
    merchant: "..."
};
```

---

### Farm Target Configuration

**Status: KEEP / IMPROVE**

Current primary farm target:

```text
cgoo
```

An additional list of allowed monsters exists for other systems.

### V2 Requirement

Farm targets must be configurable and must not be globally overwritten by event or monster-hunt logic.

---

### Potion Configuration

**Status: KEEP**

V1 defines:

```text
hpot1
mpot1
```

Minimum stock:

```text
5
```

Purchase batch:

```text
400
```

### V2 Requirement

Potion type, reserve, purchase amount, and resupply triggers should be configurable.

---

### Sell List

**Status: KEEP / RETHINK**

V1 contains an explicit list of items that may be sold.

Positive:

- Whitelist-based selling reduces the risk of accidentally selling unknown items.

Problem:

- The list is static and likely outdated.

### V2 Requirement

Use an explicit item policy:

```text
KEEP
SELL
EXCHANGE
UPGRADE
COMPOUND
BANK
UNKNOWN
```

Unknown items should never be automatically sold by default.

---

### Upgrade Whitelist

**Status: KEEP**

Automatic upgrades are configured up to target levels.

Examples:

```text
t2bow    → +6
sword    → +4
pmace    → +6
crossbow → +6
basher   → +6
```

---

### Compound Whitelist

**Status: KEEP**

Automatic compound rules exist for selected accessories.

Current target:

```text
+1
```

---

## 4. Main Scheduler

### Combat / Movement Loop

**Status: RETHINK**

Runs every:

```text
75 ms
```

and executes:

```text
state_controller()
→ current state behavior
```

Problems:

- Too many responsibilities depend on the same fast timer.
- State transitions, movement, combat, and event behavior are tightly coupled.

### V2 Requirement

A central scheduler should manage different update frequencies cleanly, for example:

```text
Combat Tick
Movement Tick
Utility Tick
Inventory Tick
Party Tick
Economy Tick
```

---

### Utility Loop

**Status: IMPROVE**

Runs every 500 ms:

```text
use_pots
create_party
manage_inventory
manage_respawn
loot
```

The concept of different update frequencies is useful.

The implementation should be replaced.

---

## 5. Main Character State Machine

Existing states:

```text
farm
merchant_state
get_monsterhunt
monsterhunt
snowman
phoenix
resupply
```

### State Priority

Potions have high priority.

The remaining priority is approximately:

```text
Snowman
Monster Hunt
Phoenix
Normal Farm
```

The Merchant receives its own special state.

**Status: RETHINK**

The state-machine concept is useful, but the global state machine mixes:

- Mission
- Combat
- Movement
- Resupply
- Events
- Character role

### V2 Requirement

V2 should use a clearer task/behavior hierarchy instead of one global string-based state machine.

---

## 6. Automatic Respawn

**Status: KEEP**

When the character is dead:

```text
respawn()
```

V1 uses roughly a 10-second cooldown between attempts.

### V2 Requirement

Automatic respawn with a clean cooldown and recovery behavior after respawning.

---

## 7. Potion Usage

**Status: KEEP / IMPROVE**

HP Potion:

```text
HP <= 70%
```

MP Potion:

```text
missing MP >= 750
```

Problems:

- No differentiated class logic.
- No consideration of upcoming skill costs.
- No sophisticated HP/MP prioritization.

### V2 Requirement

Central resource-management policy with role-dependent thresholds.

---

## 8. Normal Farming

**Status: KEEP / IMPROVE**

The bot:

1. Searches for a relevant monster.
2. Attacks if it is in range.
3. Moves toward it otherwise.
4. Uses `smart_move` to reach the farming area if no monster is visible.

A special arena path exists for `cgoo`.

### V2 Requirement

This remains one of the core capabilities.

Target selection, movement, and combat must become separate systems.

---

## 9. Target Selection

### Party-Aware Targeting

**Status: KEEP / IMPROVE**

`find_viable_targets()` considers:

- Configured monster type
- Monsters attacking the current character
- Monsters attacking party members

Priority:

```text
1. Monsters threatening the party
2. Distance
```

This is one of the stronger V1 concepts.

Problems:

- Filter conditions are difficult to read and potentially error-prone due to mixed `&&` / `||`.
- Monster objects are extended with `targeting_party`.

### V2 Requirement

Create a dedicated Targeting Service with explicit scoring.

Potential factors:

```text
Threat to party
Target type
Distance
HP
Aggro
Role suitability
```

---

## 10. Party Formation / Following

**Status: RETHINK**

All characters except the Tank attempt to remain near the Warrior.

Tank:

```text
DampiixWar
```

Characters:

- Change to the Warrior's map.
- Move near the Warrior.
- Attempt to remain within roughly 80% of their own attack range.

Positive:

- Tank-centered formation is conceptually useful.

Major problems:

- Direct access to other character iframes through browser internals.
- Code is explicitly marked `NEEDS MORE WORK`.

### V2 Requirement

Completely new formation and coordination system.

Direct browser iframe access should not be the primary communication mechanism.

---

## 11. Movement

### Direct Movement

**Status: KEEP AS CAPABILITY / REWRITE**

When a target is directly reachable, V1 moves directly toward it.

Otherwise `smart_move()` is used.

Useful principle:

```text
Direct movement when possible
Pathfinding when necessary
```

Problem:

- V1 partially manipulates Smart Move internals directly.

### V2 Requirement

Dedicated Movement Service.

Other systems should request movement rather than manipulate pathfinding internals.

---

## 12. Priest Healing

**Status: KEEP / IMPROVE**

The Priest collects visible party members and calculates:

```text
HP / Max HP
```

The party member with the lowest health percentage is selected.

Heal trigger:

```text
< 90%
```

If outside heal range:

```text
move toward heal target
```

Positive:

- Percentage-based prioritization is sensible.

Problems:

- Basic heal only.
- No skill prioritization.
- No danger assessment.
- No consideration of:
  - expected damage
  - Tank priority
  - self-survival
  - MP
  - heal cooldowns
  - incoming damage

### V2 Requirement

Priest Combat Controller / Healer Service.

First reach V1 parity, then expand significantly.

---

## 13. Automatic Party Creation

**Status: KEEP / IMPROVE**

Warrior:

- Invites all party members.

Other characters:

- Accept invitations from the leader.
- Leave incorrect parties.

The bot detects whether all four configured party members are present.

Problems:

- Fixed four-person assumption.
- `party_created` recovery is not robust.

### V2 Requirement

Dynamic party membership and recovery after disconnect, death, or restart.

---

## 14. Inventory Management

**Status: KEEP / RETHINK**

V1 regularly executes merchant transfer behavior.

When fewer than three inventory slots are free, the character also attempts to visit a vendor and sell configured items.

Problem:

- Inventory management, selling, movement, and merchant logistics are tightly mixed.

### V2 Requirement

Dedicated Inventory Service and Item Policy system.

---

## 15. Automatic Item Transfer to Merchant

**Status: KEEP / IMPROVE**

Non-Merchant characters send items to the Merchant when the Merchant is visible/in range.

Items retained locally include:

```text
hpot1
mpot1
tracker
```

Problem:

- Unknown items are broadly routed to the Merchant.
- Slot lookup can be redundant and potentially select unexpected duplicate items.

### V2 Requirement

Explicit inventory routing.

---

## 16. Gold Transfer to Merchant

**Status: KEEP / IMPROVE**

Characters retain a gold reserve:

```text
100,000
```

When gold exceeds:

```text
200,000
```

they send:

```text
100,000
```

to the Merchant.

### V2 Requirement

Configurable gold reserve and treasury policy.

Long term, the Merchant should be able to centrally distribute economy resources as needed.

---

## 17. Automatic Selling

**Status: KEEP**

Items from `sell_list` are automatically sold.

Locked/protected items are not sold.

Positive:

- Explicit sell list.
- Protected items are respected.

### V2 Requirement

Integrate this into the new Item Policy system.

---

## 18. Inventory Full Recovery

**Status: KEEP / IMPROVE**

With fewer than three free slots:

```text
move to vendor area
→ sell items
```

Problem:

No complete recovery behavior exists for:

```text
Inventory full
+
nothing sellable
```

### V2 Requirement

Recovery policy:

```text
Sell
→ Merchant
→ Bank
→ Stop / warning
```

---

## 19. Potion Resupply

**Status: KEEP / IMPROVE**

When a potion type falls below five:

```text
resupply
```

The character moves to the potion merchant and purchases up to:

```text
400
```

Problems:

- Purchase cost is calculated but not meaningfully checked.
- The `"Not Enough Gold!"` branch does not correctly represent an actual gold check.

### V2 Requirement

Clean checks for:

```text
Current stock
Desired stock
Gold
Inventory capacity
Vendor availability
```

---

## 20. Monster Hunts

**Status: KEEP / IMPROVE**

Optional through:

```text
enable_monsterhunt
```

The bot can:

1. Acquire a Hunt.
2. Read the Hunt type.
3. Check whether the monster is allowed.
4. Search for the target.
5. Travel to it.
6. Kill the target.
7. Turn in the Hunt.

Positive:

- A complete basic Hunt workflow exists.

Problems:

- Disabled by default.
- NPC is found through a fragile hardcoded array index.
- Priest is explicitly excluded when acquiring new Hunts.
- Unsupported Hunts lack robust recovery behavior.

### V2 Requirement

Monster Hunts should become their own Task.

NPCs should be resolved through stable identifiers/data rather than array positions.

---

## 21. Snowman Event

**Status: KEEP / IMPROVE**

When a global Snowman event is present, Combat characters automatically switch to it.

Capabilities:

- Detect event location
- Find Snowman
- Travel to it
- Attack
- Priest healing
- Warrior Taunt

Positive:

- First real party-wide event behavior.

### V2 Requirement

Do not hardcode Snowman into the main state machine.

Create a generic Event Framework and implement Snowman as an Event Strategy.

---

## 22. Warrior Taunt

**Status: KEEP / IMPROVE**

During Snowman and Phoenix behavior, the Warrior uses Taunt.

When MP is low, a Mana Potion is used.

Problem:

- No general Warrior combat system.
- Taunt is embedded inside event-specific logic.

### V2 Requirement

Warrior Role Controller with a reusable skill policy.

---

## 23. Phoenix / Firebird Farming

**Status: INCOMPLETE / RETHINK**

Optional through:

```text
farm_firebird
```

Mage:

- Searches for Phoenix.
- Moves to it.
- Attempts to bring other party members using Magiport.

Other Combat characters:

- Search for Phoenix / `mvampire`.
- Warrior uses Taunt.
- Fall back to the normal monster list.

Major problems:

- Implementation appears unfinished.
- Party member tracking is unclear.
- Magiport success tracking is fragile.
- State reset is fragile.

### V2 Decision

The feature goal remains interesting.

The implementation should be discarded.

---

## 24. Magiport Acceptance

**Status: INCOMPLETE / DROP IMPLEMENTATION**

Characters accept Magiport from:

```text
Dampiiix
```

`accept_magiport()` is called repeatedly as an apparent workaround.

### V2 Requirement

Single validated Magiport communication flow.

---

## 25. Merchant Automation

The Merchant has its own state machine.

States:

```text
collecting
selling
exchanging
upgrading
```

---

## 26. Merchant Collection Cycle

**Status: KEEP / RETHINK**

A collection run is intended to start roughly every 300 seconds.

The Merchant visits party members sequentially.

When close enough, it advances to the next character.

After completion it returns to normal work.

Positive:

> Combat characters continue farming while the Merchant runs a logistics route.

Problems:

- Merchant does not actively retrieve items.
- It relies on `send_to_merchant()` running on Combat characters.
- Fixed party order.
- No robust handling of offline characters.

### V2 Requirement

Merchant Logistics Task with explicit collection targets.

---

## 27. Merchant Selling

**Status: KEEP / IMPROVE**

Outside collection runs, the Merchant returns toward Main City and sells configured items.

---

## 28. Merchant Exchange State

**Status: INCOMPLETE**

The state:

```text
exchanging
```

and an `exchanging()` function exist, but no meaningful implementation is present.

### V2 Requirement

Only include this in mandatory parity if the standalone `exchange.js` behavior is later considered part of the productive V1 workflow.

---

## 29. Standalone Item Exchange

**Status: KEEP / RETHINK**

`exchange.js` contains a functional automatic exchange loop independent from the Merchant system.

Currently configured for:

```text
weaponbox
```

It:

- Finds matching item stacks.
- Checks required exchange quantity.
- Starts the exchange.
- Waits for the exchange queue.

Problem:

- Not cleanly integrated into `auto-merchant`.

### V2 Requirement

Integrate Exchange into the Merchant/Economy system.

---

## 30. Merchant Upgrade Detection

**Status: KEEP**

The Merchant automatically checks for items below their configured target upgrade level.

If found:

```text
state → upgrading
```

---

## 31. Automatic Upgrade

**Status: KEEP / IMPROVE**

The bot:

1. Finds upgrade candidates.
2. Determines the appropriate scroll tier.
3. Searches for the scroll.
4. Buys a missing scroll.
5. Executes the upgrade.

Positive:

- Configurable upgrade limits.
- Scroll tier is selected based on item grade.

Problems:

- Direct socket events instead of an abstraction.
- No offering/protection strategy.
- No robust gold control.
- No risk policy.

### V2 Requirement

Upgrade Engine with a clear policy.

First reach feature parity, then add smarter risk optimization.

---

## 32. Automatic Compound

**Status: INCOMPLETE / KEEP FEATURE**

`compound_items()` can broadly:

- Group compatible items.
- Find three items at the same level.
- Determine the appropriate compound scroll.
- Buy a missing scroll.
- Execute Compound.

Problem:

- Merchant state selection does not actually integrate the Compound system.
- `check_for_compound()` exists but is not integrated into Merchant state selection.

### V2 Decision

The capability was clearly planned and mostly implemented.

Treat V1 as:

```text
PARTIALLY IMPLEMENTED
```

Reconsider immediately after core parity.

---

## 33. Merchant Luck

**Status: INCOMPLETE / RETHINK**

`merchant_mluck()` can search for characters in range and cast `mluck`.

Its calls are commented out.

### V2 Decision

Not part of actual V1 feature parity.

Re-evaluate later against current Merchant capabilities.

---

## 34. Looting

**Status: KEEP**

V1 regularly calls:

```text
loot()
```

Basic automatic looting is therefore available to each character.

---

## 35. Gather in City Debug Mode

**Status: DROP / DEV TOOL**

A `gather_in_city` option can temporarily send all characters to Main City.

This appears to be a development/debug switch.

### V2 Requirement

Do not treat this as a product feature.

If useful, recreate it later as an Admin/Debug command.

---

## 36. Browser / Cross-Character Access

**Status: DROP IMPLEMENTATION**

`get_parent()` directly accesses browser/character iframe structures.

This is especially used for Warrior position tracking.

### V2 Decision

Do not carry this implementation forward.

Cross-character coordination should use an explicit communication model.

---

## 37. Logging / Status Display

**Status: KEEP / IMPROVE**

V1 uses:

```text
game_log()
set_message()
```

for status information.

Examples:

```text
farming
getting MH
SNOWMAN
resupplying
collecting
selling
upgrading
```

### V2 Requirement

Central Logger with levels such as:

```text
DEBUG
INFO
WARN
ERROR
```

plus concise character-state display.

---

# 38. Actual V1 Feature-Parity Baseline

The following capabilities define the mandatory first V2 parity target.

## Core

- [KEEP] Start additional characters
- [KEEP] Role-based character execution
- [KEEP] Automatic respawn
- [KEEP] Automatic looting
- [KEEP] Status display

## Party

- [KEEP] Automatically create party
- [KEEP] Automatically accept party invitations
- [KEEP] Leave incorrect party
- [RETHINK] Tank-centered follow system

## Farming

- [KEEP] Configure farm target
- [KEEP] Automatically find targets
- [KEEP] Prioritize party aggro
- [KEEP] Prioritize targets by distance
- [KEEP] Automatically attack
- [KEEP] Automatically move toward enemies
- [KEEP] Automatically locate farming area

## Priest

- [KEEP] Monitor party HP
- [KEEP] Find party member with lowest HP percentage
- [KEEP] Automatically heal below 90%
- [KEEP] Move toward heal target

## Resources

- [KEEP] Automatically use HP Potions
- [KEEP] Automatically use MP Potions
- [KEEP] Monitor potion stock
- [KEEP] Automatically resupply potions

## Inventory

- [KEEP] Monitor free inventory slots
- [KEEP] Automatically sell configured junk items
- [KEEP] Send loot to Merchant
- [KEEP] Retain configured items
- [KEEP] Send excess gold to Merchant

## Merchant

- [KEEP] Periodic collection runs
- [KEEP] Visit party members sequentially
- [KEEP] Sell items
- [KEEP] Detect upgrade candidates
- [KEEP] Automatically upgrade items

## Monster Hunts

- [KEEP] Automatically acquire Hunt
- [KEEP] Read Hunt
- [KEEP] Recognize supported Hunt monsters
- [KEEP] Search for Hunt target
- [KEEP] Kill Hunt monsters
- [KEEP] Automatically turn in Hunt

## Events

- [KEEP] Automatically detect Snowman event
- [KEEP] Travel to event location
- [KEEP] Fight Snowman
- [KEEP] Warrior Taunt during event
- [KEEP] Priest healing during event

---

# 39. Legacy Experimental Features

These are not mandatory for the first V2 parity release:

```text
Phoenix automation
Magiport orchestration
Merchant Luck
Merchant Exchange State
Automatic Compound
```

They are retained as:

```text
Legacy Experimental Features
```

and should be re-evaluated immediately after stable V1 parity.

---

# 40. Major V1 Architecture Problems

The rewrite is justified by several structural issues.

## 1. Global State

Most systems rely on global state.

This allows unrelated systems to influence each other unintentionally.

## 2. Hidden Conventions

Examples:

```text
party_list[0] = tank
party_list[3] = merchant
```

These meanings are not explicit in the data model.

## 3. State Machine Has Too Many Responsibilities

`farm`, `snowman`, `resupply`, `monsterhunt`, etc. mix missions with technical subsystems.

## 4. Movement Logic Is Distributed Everywhere

Combat, Priest, Hunt, Event, Merchant, and Potion code all make independent movement decisions.

## 5. Combat Is Not Properly Role-Abstraction Based

Priest has some specialized logic.

Warrior skills are embedded directly into event functions.

Mage has almost no general class logic.

## 6. Cross-Character Coupling

Direct browser iframe access creates strong coupling.

## 7. Economy Is Fragmented

Selling, Merchant Collection, Exchange, Upgrade, and Compound are not part of a unified economy system.

## 8. Hardcoded Game Data

Examples include hardcoded NPC array indexes.

## 9. Weak Error Handling

Many edge cases can lead to stalled or repeating loops.

## 10. No Consistent Communication Model

Characters coordinate indirectly through:

- Party state
- Visibility
- Iframes
- World state

but not through a defined bot communication layer.

---

# 41. V2 Rewrite Scope

## V2 Phase 1 — Foundation

New architecture:

```text
Bootstrap
Configuration
Scheduler
Logger
Character Context
Task / Behavior System
Movement Service
Communication
```

## V2 Phase 2 — Party + Farming

```text
Character startup
Party management
Formation
Targeting
Movement
Basic attack
Loot
Respawn
```

## V2 Phase 3 — Roles

```text
Warrior controller
Mage controller
Priest controller
Merchant controller
```

Reach V1 Priest-healing parity.

## V2 Phase 4 — Resources & Inventory

```text
Potions
Resupply
Inventory policy
Item routing
Gold routing
Selling
```

## V2 Phase 5 — Merchant Economy

```text
Collection route
Selling
Upgrade
```

## V2 Phase 6 — Monster Hunts

Implement the complete V1 Hunt workflow.

## V2 Phase 7 — Events

Implement Snowman as the first Event Handler.

---

# 42. V2 Feature-Parity Definition of Done

V2 reaches V1 feature parity when:

```text
Warrior starts the party
        ↓
Party forms automatically
        ↓
Characters locate the configured farming area
        ↓
Party farms autonomously
        ↓
Priest keeps the party alive
        ↓
Characters use potions
        ↓
Potions are resupplied automatically
        ↓
Loot and gold are routed to the Merchant
        ↓
Merchant collects / sells / upgrades
        ↓
Characters respawn automatically
        ↓
Monster Hunts can be completed autonomously
        ↓
Snowman event can be handled autonomously
```

At that point:

```text
V1 = retired
V2 = production baseline
```

From there, development moves beyond the rewrite into active expansion.

---

# 43. Post-Parity Legacy Features

Immediately after V1 parity, re-evaluate:

```text
Phoenix hunting
Magiport coordination
Auto compound
Auto exchange
Merchant Luck
```

Afterward, review current Adventure Land systems and documentation and create the V2.x roadmap for capabilities that V1 never implemented.

---

# 44. Rewrite Principle

The central rule for the V2 project is:

> **V1 is the specification, not the codebase.**

V2 may reproduce useful V1 behavior, but old implementations should not be copied merely because they already exist.

For every capability:

1. Understand the intended behavior from V1.
2. Define the V2 requirement.
3. Design the appropriate V2 architecture.
4. Implement it cleanly.
5. Validate behavior against the V1 parity baseline.
6. Only after parity, extend beyond V1.

This preserves the useful lessons and capabilities of the legacy bot without carrying its architectural debt into V2.
