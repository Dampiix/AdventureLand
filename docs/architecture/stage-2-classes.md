# Stage 2: all classes as modules (plan, 2026-11-24)

Status: **built and live (every class done, see the table).** After the mage pilot ([pilot-mage.md](pilot-mage.md)), same rules, same branch
(`modular-pilot`), **no change in behaviour**. Each class becomes `classes/<class>/<class>.js` (what it is, which skill
modules it has, their deps from ctx) plus one module per skill (or group of small skills); the slot names stay, each
slot becomes a bundle. The fighter's class interface stays: `name, survive, always, support, fight` and the optional
`supportInPlace, meetIncoming, onDeath, move`.

## Split

| Class | Today | Modules |
|---|---|---|
| priest | 252 lines, live | `priest.js`; `heal.js` (hurt members, heal, far member low, Party Heal); `absorb.js`; `luck-catch.js` (luck set on the kill, with gear.luckOn); `revive.js`; `curse.js` (Curse on sturdy targets); `dark-blessing.js` (Dark Blessing on long fights: sturdy targets, bosses) - **done** (849463e) |
| ranger | 92, not running | `ranger.js`; `three-shot.js` (3-Shot targets); `sturdy-shots.js` (Hunter's Mark, Supershot, Poison Arrow) - **done** |
| rogue | 153, not running | `rogue.js`; `swiftness.js` (Rogue Swiftness); `stealth.js` (Assassin's Smoke, quiet spot, visible again); `fanofknives.js` (Knife Belt skill); `strikes.js` (Quick Stab/Punch, Mental Burst, Poisonous Touch) - **done** |
| paladin | 93, not running | `paladin.js` (with Selfheal and Smash); `mana-shield.js`; `oath.js` (Guardian's Oath); `cleansing.js` - **done** |
| warrior | 1,606, live | `warrior.js` (class, hooks; Hard Shell, War Cry, Cleave, Stomp inline); `common.js`; `protect.js` (Taunt, protective Agitate); `mobility.js` (Charge, Dash); `agitate-mode.js`; `agitate-point.js`; `agitate-stream.js`; `agitate.js` (pack tick); `splash.js`; `escape.js`; `sword-swap.js` - **done**. The parts were moved verbatim by a script (game globals to lib/game.js, ctx to deps); the Agitate parts share one internal state `w` and call each other through it - one feature in several files. Outside dependencies only through `deps`. |

Shared helpers the warrior uses in several of its modules (reserve MP, monsters around us, spiky near, our kind) go
into `classes/warrior/common.js`. Module state that several parts share today (e.g. the last Agitate for the death
block) is owned by one module and read through its interface.

## Order (one commit and one deploy each)

1. **priest** - live: reload the priest after the usual checks, watch heals, Party Heal, Absorb, luck catch.
2. **ranger, rogue, paladin** - not running on Viz: Node tests only (old vs new, same calls), deploy, no reload needed.
3. **warrior** - the big one, live: reload the warrior, watch Agitate at the Giant Scorpions, Cleave/Stomp, sword swap,
   Charge on the way, a boss (escape logic stays quiet unless a fight goes bad).
4. **config comments** for all class blocks shortened (values unchanged), with the warrior commit or on its own.

## Checks per class

- `scripts/test-classes.cjs` (from `test-mage.cjs`): the fake game generalised; per class 4-8 situations; run old
  single file vs new folder, every game call must be the same. Warrior: Agitate with a pack in reach, no Agitate with a
  foreign kind in reach, Cleave/Stomp counts, taunt a monster on a member, Hard Shell at low HP, sword swap for a weak
  target, Charge on the way, escape when the team can't hold.
- `scripts/test-bundle.mjs` and `test-mage.cjs` stay green.
- Live: version `1.237.x-pilot`, heartbeats, the class's log lines and journal as before; no reload during a boss event.

## Not in stage 2

The fighter, targeting, party/events cycle, workshop and merchant (stages 3+). No feature changes - ideas found on the
way are noted (e.g. the mage's target choice for the Blaster, the walk to an old team goal).
