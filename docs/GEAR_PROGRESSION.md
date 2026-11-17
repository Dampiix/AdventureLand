# Planned gear progression (after shop gear +7)

Status: **plan only, nothing implemented yet** (decided 2026-11-16). Before building
any of this, we first want to see what the in-game progression guide asks for once
its current lessons (shop armor/weapon +7, jewelry +2) are done.

Source: game data version 18285 (items, sets, tokens, craft recipes, drop tables),
evaluated by hand. The official docs say almost nothing about gear after the shop.
The full catalog (every armor piece, weapon and offhand with stats and sources) is
built by `scripts/gear-catalog.mjs` into `docs/gear-catalog/gear-catalog.pdf`.

## Decided progression (2026-11-16) – the bot must work the same on a fresh account

**Armor:** follow the guide's wishes; in parallel the gear goals push ALL worn shop
armor to +7, then all to +8 (`gearGoals.stages`). From +7 each level adds +3 main stat
(+7: 9, +8: 12, +9: 15). Capped at +8 (2026-11-16): per piece +8 ~170 copies / 1.1M,
+9 ~2400 copies / 17M (~250M for the team), +10 ~770M. Our own lists (class wishes,
Hunter set, token buys, spare upgrades) are paused until this is done.

**Armor after shop +8: Rugged** (community order: store -> rugged -> heavy -> darkforge).
Rugged is a toughness trade: +7 has 10 stat (vs 12 at shop +8) but ~3x the armor and
resistance; set bonus 2 pcs +1 all stats, 3 pcs +20 armor/+20 resistance, 4 pcs +8 FOR,
5 pcs +4 speed. Copies only from Armor Boxes (~95 % Rugged: helmet/gloves ~23 % each,
pants 21 %, coat/shoes 14.5 %); +7 needs ~30 copies and ~6M per piece, +8 ~218 copies –
so the target is +7, helmet/gloves/pants first (3-piece bonus). Collect armor boxes
meanwhile (Raw Emerald exchange, Skeletor, Mimics, leather). **Decided 2026-11-16:
Rugged +7 for tanks only** (warrior, paladin): it costs 2 main stat per piece against
shop +8, which hurts the priest's healing and the ranger's damage, while the tank
gains ~3x armor/resistance. Priest and ranger keep shop +8.

**Monster Hunter sets: long-term only** (decided 2026-11-16). Main stat is just +1
over shop per level (Hunter +7: 10, shop +8: 12), so they only beat shop +8 at +8;
full set +7 with its bonus is 56 vs 60 main stat (plus armor and piercing). A set
costs 53 Monster Tokens per copy (hat 7, gloves 8, pants 11, armor 12, shoes 15), and
+7 needs many copies (high grade, grace -1). Tokens are collected meanwhile.

**Grace** (game source, server.js upgrade): every failed attempt at +L adds 1 player
grace for +L whatever the item; it counts as min(3, fails / 4.5) plus the upgraded
item's own grace and a base-grade term (normal +1, high -1, rare -2), plus server
grace (everyone's fails, min 6, reset by anyone's success), and is then divided by
L and 4.8 minus a threshold. So fodder grace only helps normal-grade items (shop gear);
high/rare items (fire weapons, Rugged, Hunter) gain ~0-1 %. Offerings (Primling x1.4)
are the real lever, but only buyable from players.

**Weapons** (not implemented beyond step 2 yet):
1. Shop weapon of the class, pushed to +7 by the gear goals.
2. Fire weapons (Phoenix drops, weapon boxes, craft: shop weapon + essence of fire)
   are upgraded in the background; whichever is stronger in the fighter's hands – shop
   or fire weapon – is worn (`betterWeapons`, both directions).
3. **Next step: the "of the Dead" weapons.** Once the worn weapon (shop or fire) is
   +7, the class's Dead weapon is built in the background and replaces it as soon as
   it is stronger. Copies are cheap and farmable – **Bones** (Zombies 1/100, weak:
   9k HP / 260 attack; Dino 1/400; Pale Dino 5 per kill) + a shop base + a fee:
   | Class | Dead weapon | +7 | vs fire +7 | Recipe |
   |---|---|---|---|---|
   | Warrior (dual wield) | Mace of the Dead x2 | 63.5 each after the mace -8 % | 2x54 -> 2x63.5 (+17 %) | Bones + Wooden Basher + 240k |
   | Priest | Staff of the Dead | 82 | 75 (+9 %) | Bones + Staff + 120k |
   | Ranger | Bow of the Dead | 82 (+2.5 crit) | 76 (+8 %) | Bones + Bow + 120k |
   | Paladin | Mace of the Dead | 69 | 54 fireblade | Bones + Wooden Basher + 240k |
   Notes: ~30 copies to +7 on average (guide model, no grace), Rare scrolls (1.6M)
   from +5/+6; Staff/Bow of the Dead carry STR (off-stat for priest/ranger) and -6/-12
   speed; Sword of the Dead (60 + 10 STR) needs a "Sword" from weapon boxes – not
   farmable, so the warrior takes maces. There is no Axe of the Dead; axes are
   two-handed (Cleave from 52) and lose to dual wield on single targets.
4. **Fire weapon ladder** (`workshop.bruteForce`, decided 2026-11-16): grace can't lift
   them, so spare copies (drops, Dracul, archive) are upgraded at once with the normal
   scroll – always to one level above the weakest worn copy in the team (both of the
   warrior's blades count). A spare that gets there is swapped in and the old copy
   becomes the next spare; the next level starts only once every worn copy is at the
   top. Worn copies are never risked. Dracul (cave) is now a searched boss: firestaff
   5 %, stat earrings 10 % each, Dracul's Attire 3 % (kept in the bank for later).

**Stat slots** (evaluated 2026-11-16): compound jewelry costs ~12 +0 copies for +2,
~91 for +3, ~1100 for +4 (guide model) – +2 is the realistic target.
- Belt: Belt of STR/INT/DEX +2 = +10 over the HP belt (0) – Spookytown map drop
  (1/1429 per kill, type random, every type fits one of our classes). Biggest gain,
  but Spookytown (mummies, booboos, stoneworms) is not safe yet.
- Rings: stat ring +2 (6) over Ring of Small Joys +2 (3) – Winterland/winter cave map
  drop 1/2000 (type 1/4); arctic bees are safe. Later crafts: Emberseal etc. (+2 = 12).
- Amulet: stat amulet +3 (13 vs 10) needs ~91 copies – Halloween map drop 1/1429
  (snakes are safe) or Dracul (30 %). Collected on the side, auto-compounded.
- Earrings: Phoenix (12 % per type) – events.
- Orb: class orb +2 (10) from Fire Spirits / big Pom Pom; Orb of Beginnings +2 (4 all)
  needs porcupine leather – both spots not safe yet. Cape (+4): leather from wolves.
- Party Hat: dropped – each copy costs 2 fun tokens, +9 would need ~4800 tokens;
  at the reachable +7/+8 it loses to shop +9.
Conclusion: after shop +9 the next target is a **spot**, not an item – once the team
farms Spookytown, wolves and Fire Spirits safely, belts, cape and orbs open up.

## What the in-game guide asks for (read 2026-11-16)

The guide's lesson list ends with shop gear. Lessons per class (same pattern for all):
foundation (weapon +3, armor +0) → working (weapon +5, armor +3 with main stat) →
amulet (+0) → amulet2 (+2) → earrings (+0) → rings (stat rings +0) → rings2 (+2) →
earrings2 (+2) → equipment (weapon +7, armor +7 with main stat, Book of Knowledge
`wbook0` +2 in the offhand for paladin and priest).

Progress then: DmpxPala attack 561/1000, DmpxRanger attack 472/1000, DmpxPriest
heal 848/1000. The remaining lessons add little (+6 to +15 each), so the shop path
alone does not reach 1000 for the fighters – what the guide does after the last
lesson is unknown until a character gets there.

The in-game guide window (screenshot 2026-11-16) shows only 8 of these lessons:
`rings2` (stat rings +2) is not listed there, but its farm suggestion (Water Spirit
for Ring of Strength) still appears in the "Move" list. The last lesson, "Build a
lasting equipment foundation", covers spare +7 armor/weapons and books from bats for
offhands, and says level gains may finish the goal without another costly upgrade –
so after the lessons the guide expects levels to close the gap to 1000 attack.
"Bring both earrings to +2" says to develop spare earrings while keeping both ears
equipped (we never compound worn copies – decided 2026-11-16).

With an explicit goal the guide plans beyond the shop:
- `{ kind: "set", name: "oathkeeper" }` (paladin): Concord Mace +5 via 12 monster
  tokens, +82 attack (expected scroll gold ~3.2M); Vowkeeper Gloves +3 STR alone
  would be -12 attack against gloves +7 (the set bonus needs more pieces).
- `{ kind: "item", name: "mace", level: 8 }`: about 170 mace copies and ~1.1M gold on
  average.

## Draft gear lists per class (2026-11-16, not implemented)

Basis: stats from the game's own item calculation (`calculate_item_properties`),
candidate at +7 (compound items +3) against what each fighter wears now. Item goals
in the guide give the way and the cost, but no gain – the gain is only computed for
its stat goal. Main finding: **tier-2 armor at +7 has the same main stat as shop +7**
(about +10 vs +9) but 3–6x the armor and resistance. Armor therefore makes the team
tougher (harder spots, bosses), while attack and healing come from weapons, orbs,
offhands and levels.

Monster Tokens: 29 in the bank (+1 carried). The Concord Mace (12) is no longer needed
since the paladin left the team – allocation between the Hunter sets still to be decided.

### Warrior (attack, tank; DmpxWar since 2026-11-16, dual fireblade +7 = 54 + 54)
Warrior hands: no penalty for short swords (fireblade), mace -8 % frequency, two-handed
axes -10 %, bashers -12 %. "Power" = attack x class modifiers, at +7.
1. **Dual wield** (done): two Fireblades +7. Single-target upgrades per hand: Fireblade
   above +7 (budget), Sword of the Dead (Bones + Sword from weapon boxes: 60), Brinefang
   (Blade +7 + 120 reefglass + cshell + 180k: 61), Hammer (weapon box 0.2 %: 71).
2. **Orb chain** (class wish): Orb of Beginnings -> Orb of Strength (Fire Spirit).
3. **Monster Hunter Warrior set** (tokens: helmet 7, gloves 8, pants 11, armor 12,
   boots 15 = 53): +7 has the shop's +10 STR but 50–64 armor and ~50 resistance per piece.
   Set: 2 pieces +2 STR, 3 pieces +3 STR +1 speed, 4 pieces +40 armor piercing, 5 crit +5.
   As the party's tank this is the most useful token buy.
4. **Rime Boots** (Rugged Shoes +6 + frostcore – 9 in stock – + 8 essence of frost + 12 Bee
   Fur + 280k) and **Reef Vest** (Rugged Coat +7 + 200 reefglass + 2 cshell + 400k).
5. Cape (class wish).
6. **Cleave (level 52) needs an axe or scythe – all two-handed**, so it costs the dual
   wield: Wooden Axe (shop) +7 73 power, Tunnel Axe (Cave of Many Dreams craft) +7 97,
   Ghastly Battle Axe (crypt key + Wooden Basher +7 + essence of life) +7 104, T3 Axe /
   Scythe ~121 (rare). Two fireblades +7 give 108 single-target. Decision for later:
   stay dual (single target, bosses) or switch to an axe on group spots (needs a
   weapon swap the bot doesn't do yet). Stomp (52) needs a basher (shop Wooden Basher).
   **Decided 2026-11-17:** Wooden Axe +8 (91 attack, ~2M with the broken copies) as a
   carried class wish once both dual-wield weapons are +7 (`carry`, `whenWorn`); it stays in
   the bag until an Agitate (68) / Cleave mode swaps it in. Mana for Cleave (720 MP): MP
   potion every cooldown while the priest heals.

### Paladin (inactive since 2026-11-16 – replaced by the warrior)
1. **Concord Mace** (12 tokens, Oathkeeper set) – +7: 70 attack (+30 %). Alternative
   Mace of the Dead (Wooden Basher + Bones + 240k): +7 69 attack, +6 STR, -8 VIT.
2. **Orb chain** (already a class wish): Orb of Beginnings -> Orb of Strength (+3: 13 STR).
3. **Oathkeeper armor** – Vowkeeper Gloves (Cole, cheap), Oathplate (Rugged Coat +
   4 pleather + 2 ascale + 20 spores + 180k), Resolute Sallet (Rugged Helmet + 12 dstones
   + 4 rfangs + 240k). Set bonus 2/3/4/5 pieces: HP/MP, then +15/25/35 armor & resistance,
   fortitude. Dawnward Aegis (5th piece, Skeletor 2 %) would replace the book (-21 INT).
4. **Rime Boots** (Rugged Shoes +6 + frostcore + 8 essence of frost + 12 Bee Fur + 280k).
5. Cape (40 Leather, class wish).

### Priest (heal; wears firestaff +7 = 75 attack)
1. **Firestaff higher than +7** (budget) – nothing obtainable beats it yet (Priest's Mace
   +7 69 attack + 23 INT, weapon box 5 %; Hand of the Dead needs scroll2 from +0).
2. **Orb chain**: Orb of Beginnings -> Orb of Intelligence (big Pom Pom, not safe yet).
3. **Monster Hunter Priest set** (tokens: hat 7, gloves 8, pants 11, armor 12, shoes 15 =
   53) – 2 pieces +3 INT, 3 pieces +3 INT +2 speed, 4 pieces +120 resistance piercing.
4. **Cinder Boots** (Rugged Shoes +6 + embercore + 8 essence of fire + 20 ashleaf + 280k).
5. Offhand: Book of Knowledge +3 (in stock); later Scribe Orb (+3: 34 INT; needs void
   thread) or Book of Secrets (Gold Earring +2 exchange, 80 %).
6. Cape.

### Ranger (attack; wears bow +7 = 61 attack)
1. **Firebow to +7** (merchant is on it: 76 attack, +25 %). Later Crossbow (+7 103 attack,
   -36 % frequency, +120 armor piercing) or Artisan's Bow (+7 91) from weapon boxes.
2. **Quiver chain to +7** (class wish, running): +9 DEX, 25 armor. Later Thistle Quiver
   (Quiver +5 + 10 pleather + 40 ashleaf + 5 essence of nature + 140k: +25 armor piercing).
3. **Monster Hunter Ranger set** (tokens, 53) – 2 pieces +3 DEX, 3 pieces +2 speed,
   4 pieces +60 armor piercing. Its gloves (+6) are the base for **Thundergrips**
   (+80 stormfeather – we hold 574 – + 12 essence of ether + 800k): +3 % frequency.
4. Orb chain (Orb of Dexterity), cape. Bogwalkers / Bog Crown need verdant cores (later).

### What the bot still needs for these lists
- Per-class ordered item goals, worked one after another (like the class wish chains).
- Armor boxes opened on demand for Rugged bases (keep 1 per piece, Heavy always).
- Crafts whose ingredient is itself an upgraded item (e.g. Rugged Shoes +6).
- Token spending decided per item (which piece gets the next tokens).

## Tiers at a glance

| Tier | Examples | Armor (helmet/chest) | Source |
|---|---|---|---|
| 1 (now) | shop helmet, coat, pants, gloves, shoes | 5 / 8 | shop |
| 1.5–1.75 | Vowkeeper Gloves, Ratwork Coat, Reed Pants, Silkgrips | ~11–17 | Cole / Leo crafts |
| 2 | Rugged set, Monster Hunter sets, Oathkeeper pieces, Mothstep Boots | 14–24 | armor box, tokens, crafts |
| 2.25–2.5 | class crafts (Bogwalkers, Cinder/Rime Boots, Thundergrips, Reef Vest) | 19–34 | crafts on tier-2 bases |
| 3 | Heavy set (wt3), vampire pieces, Amberweave Coat | 25 / 42 | rare drops, armor box (~1%) |
| 4 | Darkforge set (wt4) | 32 / 54 | armor box (~0.1%), endgame |

A tier-2 piece at +0 has roughly 2–3x the base stats of a shop piece, but it is
grade 1 from +0 on (scroll1 from the start, scroll2 from +7).

## All classes: Rugged set

`helmet1`, `coat1`, `pants1`, `gloves1`, `shoes1` – from armor boxes (`armorbox`,
over 90% a Rugged piece; also Heavy ~1% and Darkforge ~0.1% per piece).
Set bonus: 3 pieces +20 armor/+20 resistance (+2 range), 4 pieces +8 fortitude,
5 pieces +4 speed and status resistances.
Mainly needed as the **base for class crafts** (Oathplate, Resolute Sallet,
Rime/Cinder/Bog boots, Reef Vest).

## Paladin: Oathkeeper set

No Monster Hunter set exists for paladins. Full set (5): +700 HP, +350 MP,
+35 armor, +35 resistance, +8 fortitude, courage.

| Piece | How |
|---|---|
| Vowkeeper Gloves | Cole: 60 beewings + 30 spores + 2 crabclaw (cheap, ingredients mostly owned) |
| Oathplate | craft: coat1 + 4 pleather + 2 ascale + 20 spores + 180k |
| Resolute Sallet | craft: helmet1 +0 + 12 dstones + 4 rfangs + 240k, or 12 PvP tokens |
| Concord Mace | 12 monster tokens (one is on the archive char DampiixWar) |
| Dawnward Aegis | shield – source not found in the data |

Other paladin crafts: Rime Boots (shoes1+6, frostcore, 8 essence of frost, 12 bfur),
Reef Vest (coat1+7, 200 reefglass, 2 cshell).

## Priest: Monster Hunter Priest set

`mphat` 7, `mparmor` 12, `mppants` 11, `mpgloves` 8, `mpshoes` 15 monster tokens
(53 for the set). Bonus: INT, speed, +120 resistance piercing, full set +2000 MP.
Class crafts: Cinder Boots (shoes1+6, embercore, 8 essence of fire, 20 ashleaf),
Silkgrips (gloves+5, spidersilk, voidthread, bwing), Ember Hood (mmhat+5, embercore,
essence of fire, ashleaf).

## Ranger: Monster Hunter Ranger set

`mrnhat` 7, `mrnarmor` 12, `mrnpants` 11, `mrngloves` 8, `mrnboots` 15 monster
tokens (53). Bonus: DEX, speed, +60 armor piercing, full set +100 resistance.
Class crafts: **Thundergrips** (mrngloves+6, 80 stormfeather, 12 essence of ether –
we hold 250+ stormfeathers), Bogwalkers (shoes1+6, verdantcore, 12 poison,
8 snakefang), Bog Crown (helmet+7, verdantcore, 12 poison, 40 ashleaf),
Reed Pants (pants+6, 20 frogt, 4 lotusf, 40 ashleaf).

## All classes: Cave of Many Dreams

Mothstep Boots (6 cave amber + shoes + 2 beewings): speed and evasion.
Amberweave Coat (300 cave amber, coat, 30 spidersilk, 20 cscale): tier 3, long-term.

## Later (tier 3/4)

Heavy and Darkforge sets (armor boxes, rare), vampire pieces (Spike's Attire,
Vampiric Gloves/Boots from vampires), market-parcel items.

## Suggested order (not started)

1. Vowkeeper Gloves for the paladin (cheap, almost all ingredients owned).
2. Collect monster tokens (more hunts) for the Priest and Ranger Hunter sets.
3. Open armor boxes for Rugged pieces as craft bases.
4. Then the bot needs fixed wishes ("set goals") beyond what the guide asks for.
