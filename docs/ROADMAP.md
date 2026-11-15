# Bot roadmap

Goal: bring the new bot (`bot/`) to the feature level of the legacy V1 bot (`v1/`,
described in `ADVENTURELAND_BOT_V1_LEGACY_FEATURE_AUDIT.md`), then grow beyond it.
Written 2026-11-15 against game data version 18285.

## 1. Parity check: V1 vs. bot v1.0.1

Legend: ✅ done · 🟡 partial · ❌ missing · ➕ new in the new bot (V1 never had it)

### Core
| V1 capability | Status | Notes |
|---|---|---|
| Leader starts the other characters | ✅ | `start_character` per phase (`config.phases`) |
| Role-based execution | ✅ | explicit roles in `config.characters`, class from `ctype` |
| Automatic respawn | ✅ | 5 s retry |
| Automatic looting | ✅ | |
| Status display | ✅ | `set_message` + tagged `game_log` |
| Cross-character communication | ✅➕ | `send_cm` protocol with trusted senders (V1 read other iframes) |

### Party
| V1 capability | Status | Notes |
|---|---|---|
| Leader invites the party | ❌ | |
| Members accept invites from the leader only | ❌ | |
| Leave a wrong party | ❌ | |
| Tank-centred following | ❌ | V1 was marked "NEEDS MORE WORK" |

### Farming
| V1 capability | Status | Notes |
|---|---|---|
| Configurable farm target | ✅ | global or per character |
| Automatic farm target from gear/level | ➕ | `get_progression()` choices |
| Find targets, attack, move, travel to farm area | ✅ | |
| Prioritise monsters attacking **party members** | 🟡 | only monsters attacking *this* character |
| Prioritise by distance | ✅ | |

### Classes
| V1 capability | Status | Notes |
|---|---|---|
| Priest: heal lowest-HP party member < 90 %, move to it | ✅ | threshold 75 %, untested in a party |
| Warrior: Taunt (events only) | ❌ | warrior replaced by the Paladin – needs a Paladin equivalent |
| Paladin self-heal, Smash (mace only) | ➕ | |

### Resources & inventory
| V1 capability | Status | Notes |
|---|---|---|
| HP/MP potions | ✅ | thresholds in config |
| Potion resupply | ✅➕ | merchant delivers; self-buy fallback |
| Send loot and surplus gold to the merchant | ✅ | |
| Keep list | ✅ | |
| Fighter sells junk itself when the bag is full | 🟡 | only the merchant sells; fighters only ask for a pickup |
| Recovery when the bag is full and nothing is sellable | ❌ | V1 lacked it too |

### Merchant
| V1 capability | Status | Notes |
|---|---|---|
| Collection runs / visit fighters | ✅ | on request + every 15 min instead of a fixed round trip |
| Sell junk to NPCs | ✅ | sell list, protected items never sold |
| Merchant's Luck | ✅➕ | V1 had it commented out |
| Detect upgrade candidates | ❌ | V1 whitelist: t2bow 6, sword 4, pmace 6, crossbow 6, basher 6 |
| Automatic upgrade | ❌ | V1 emitted raw socket events – use `upgrade()` now |
| Automatic compound | ❌ | V1 experimental; whitelist incl. earrings +2, wbook0 +3 |
| Automatic exchange | ❌ | V1 standalone (weaponbox); bank holds 115 armorbox |

### Monster hunts
| V1 capability | Status | Notes |
|---|---|---|
| Get a hunt from Daisy, hunt the target, turn in | ❌ | now `smart_move("monsterhunter")` + `interact("monsterhunt")`; hunt state in `character.s.monsterhunt` |

### Events
| V1 capability | Status | Notes |
|---|---|---|
| Snowman: detect, travel, fight, heal | ❌ | snowman spawns in the holiday season (December); cooperative monster |
| Generic event handling | ❌ | today's events: goobrawl, crabxx, franky, icegolem, horseman, graveyard, … |

## 2. Plan

Order follows urgency: the Paladin reaches level 50 soon, the returning bonus ends on 2026-11-27,
and the holiday season (Snowman) starts in December.

### M1 – Party (v1.1) · needed when the Paladin reaches level 50 — implemented in v1.1.0, not yet tested in game
- Party management: leader invites configured members on its server; members accept only the
  leader (`on_party_invite`); leave a wrong party; verify with `get_party()`.
- Formation: the leader broadcasts its map/position; members follow within a configured distance.
- Shared target: the leader decides the farm target (progression guide) and broadcasts it;
  members assist the leader's target and prefer monsters attacking any party member.
- Priest: Party Heal when several members are hurt; Curse on the leader's target.
- Mage: Burst / Energize policy.
- `config.phase = "party"` switches the team on.

### M2 – Monster hunts (v1.2) — implemented in v1.2.0
- Leader fetches a hunt when none is active, farms the hunt monster while it is safe
  (same check as the guide's safe routes), turns it in at zero, lets unsafe hunts expire.
- Hunts are tied to the server that issued them.

### M3 – Merchant economy (v1.3) · upgrade engine + bank delivery implemented in v1.3.0 (compound/exchange still open)
- Upgrade engine: whitelist with target levels, maximum risk per step, gold reserve,
  official `upgrade()` API, scroll purchase.
- Compound engine for accessories; exchange for boxes (armorbox, weaponbox).
- Bag management: bank deposits for items that are neither sold nor used.

### M4 – Events (v1.4)
- Generic event layer: detect live events, decide per event whether the team can handle it,
  travel/`join`, fight, return to farming.
- First handlers: Snowman (holiday season), then the recurring bosses that fit the team.

### M5 – Observability
- Periodic status report (level, XP/h, kills, deaths, potions, gold) readable outside the client.

### Later
Phoenix hunting, Magiport gathering, Cave of Many Dreams, Witch's Cipher, headless via Mainframe.
