# Planned gear progression (after shop gear +7)

Status: **plan only, nothing implemented yet** (decided 2026-11-16). Before building
any of this, we first want to see what the in-game progression guide asks for once
its current lessons (shop armor/weapon +7, jewelry +2) are done.

Source: game data version 18285 (items, sets, tokens, craft recipes, drop tables),
evaluated by hand. The official docs say almost nothing about gear after the shop.

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

Monster Tokens: 24 in the bank (+2 carried). Allocation still to be decided.

### Paladin (attack; wears fireblade +7 = 54 attack)
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
