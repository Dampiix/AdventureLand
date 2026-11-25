// =====================================================================
// bot_config - our decisions: the team, prices, the gear plan, bosses, farm targets, item names. Another team (e.g.
// new level-1 characters) only needs a new `team` block; classes come from character.ctype (all six have skill modules).
// The tuning (timings, distances, thresholds) lives in the defaults.js files next to the modules (module plan, stage
// 7b): at load every setting missing here is filled from them, ours always win - so a value set here overrides the
// default for us only. Every character loads this one complete config.
// =====================================================================

const config = {
    version: "1.238.3-pilot",

    team: {
        // DampiixWar, Dampiix, DampiixPri, Dampiiix are an item archive: never list them (items would go to the merchant).
        leader: "DmpxPriest",
        fighters: ["DmpxPriest", "DmpxWar", "DmpxRanger", "DmpxRogue"],
        // Fighters outside the party: not invited, not started by the leader (at most three fighters online).
        solo: ["DmpxRogue"],
        merchant: "DampiixMerch",                       // null for no merchant
        farm: {},                                       // optional per-character farm override, e.g. { DmpxRanger: "bee" }
    },
    // Other accounts on this code (util.deriveTeam picks the team that lists the running character); one at a time.
    otherTeams: [
        { name: "viz", leader: "VizPri", fighters: ["VizPri", "VizWar", "VizMage", "VizRng"], solo: ["VizRng"], merchant: "VizMerch", farm: {} },
    ],

    // Market stand (16 slots for both, 24 from merchant level 70, 30 from 80; prices per unit in gold):
    //   buy:  { item, price, want, level?, whileWished? } - a buy order for what is missing up to "want" (bag + bank);
    //         level default +0; whileWished: only while a fighter wishes the item.
    //   sell: { item, price, keep, level? }  - everything above "keep" is offered (bank copies fetched); wished items never.
    market: {
        buy: [
            // Wanderer's set materials at about 3x the NPC value; they keep the stand open for Merrit's parcels too.
            { item: "beewings",      price:     75, want: 600 },
            { item: "crabclaw",      price:    360, want: 300 },
            { item: "spores",        price:    360, want: 200 },
            { item: "gslime",        price:     60, want: 100 },
            { item: "frogt",         price:     10, want: 10  },
            { item: "seashell",      price:    900, want: 3000 }, // elixirs: 20 of each main-stat elixir need ~2,100
            { item: "essenceoffire", price: 140000, want: 10 }, // = a fire weapon (+ shop weapon, 20k at Leo)
            { item: "ololipop",      price: 150000, want: 4  }, // orange Lolipop Mace (a player pays 300k)
            { item: "glolipop",      price:  80000, want: 4, whileWished: true }, // green one as a stand-in, only while wished
            { item: "offeringp",     price: 350000, want: 2  }, // Primling
            { item: "crossbow",      price: 400000, want: 1  }, // the ranger's long-term bow
        ],
        sell: [

            // Monster Tokens are not sold: saved for the Monster Hunter sets at Daisy (53 tokens per class).
        ],
        // Selling into players' buy orders on any server: every scanEveryMs (each trip hops out and home) a buy order at
        // minPrice+ for what is above "keep" starts a trip. buyFromPlayers: buy what Ponty would buy from players' stands.
        sellTo: {
            enabled: true,
            scanEveryMs: 20 * 60 * 1000,
            buyFromPlayers: true,
            items: [
                // Vitality earrings: +0 sold while a buyer pays minPrice, else compounded after demandHours (+1 never sold).
                { item: "vitearring", level: 0, minPrice: 500000, keep: 0, demandHours: 3 },
                { item: "vitearring", level: 2, minPrice: 8000000, keep: 2 }, // keep: the priest's two Clover Studs
            ],
        },
        // Buy orders for wished items / gear goals: priceShare of our own expected cost, at most maxShareOfPot of the gear
        // pot and max orders; not for +0 NPC stock, taken down once we hold a copy.
        wishOrders: { enabled: true, priceShare: 1.2, maxShareOfPot: 0.2, minPrice: 1000, max: 8 },
        // Ponty every everyMs: buys wished / gear-goal items better than ours at most at maxShareOfOwn of our own cost and
        // maxShareOfPot of the gear pot (also caps players' stands). reportFinds / buyFinds: other upgrades worth the gold.
        ponty: { enabled: true, everyMs: 20 * 60 * 1000, maxShareOfOwn: 1.2, maxShareOfPot: 0.2, reportFinds: true, buyFinds: true, findMinGain: 0.5 },
    },

    // Dismantle at Leo: spare copies (up to maxLevel) become material - fire weapons Essence of Fire, of-the-Dead weapons
    // Bones (materialGoals). Never: worn, wished, earmarked, locked or titled copies, or copies up to a market.buy "want".
    dismantle: {
        enabled: true,
        // Not listed: the Sword of the Dead (its Short Sword base is rare), Spear and Hand of the Dead (worth more sold).
        names: ["fireblade", "firestaff", "firebow",
            "maceofthedead", "bowofthedead", "daggerofthedead", "staffofthedead"],
        maxLevel: 0, // +1 and higher copies stay (they would only give one essence as well)
    },

    // Material goals (workshop materialGoals): weapons crafted from Essence of Fire or Bones and upgraded one copy at a time.
    //   goals:   material items of a fighter's gearPlan.weapons list that beat the worn weapon; the last list item first.
    //   deliver: "better" - each copy that beats the worn weapon; "goal" - only at the goal level (upTo, else weaponCaps).
    //   budget:  "ladder" - the workshop.bruteForce pot; "goals" - the gear goals' pot. buyCopies: buy bases;
    //   sources + sourceMaxPrice: +0 items bought to dismantle; rareBases: { item: max price }; extra: { item, level, count }.
    materialGoals: {
        enabled: true,
        auto: true,
        reserve: 0,            // material units that always stay in the bank
        maxPerGoal: null,      // null = no limit
        borrowFrom: "goals",   // "ladder" materials may borrow from the idle gear goals' pot
        skip: ["firestars"],
        materials: {
            // Fire weapons go to +8 before the Fiery Gloves and Ember Seals get any essence (workshop.materialHold).
            essenceoffire: { upTo: 8, budget: "ladder", deliver: "better", buyCopies: false, extra: [] },
            mbones: {
                upTo: 7, budget: "goals", deliver: "better", buyCopies: true,
                sources: ["maceofthedead", "staffofthedead", "bowofthedead", "daggerofthedead"], // not the Sword of the Dead: kept, never Bones
                sourceMaxPrice: 300000,
                rareBases: { sword: 150000 }, // Short Sword, the Sword of the Dead's base (no shop sells it)
            },
        },
    },

    // Our waypoints: a map behind a dangerous one is reached through a safe one (via), and left through it (leaveVia).
    travel: { via: { spookytown: "halloween" }, leaveVia: { spookytown: "halloween" } },

    // "solo":  only the leader fights (Lone Wolf bonus); the merchant still supports it.
    // "party": all fighters form a party around the leader.
    phase: "party",

    // Events and world bosses (encounters/): ours - which events and bosses, from which level, who searches what.
    events: {
        policy: {                       // "always" or "never" (default)
            snowman: "always",          // holiday season world boss, 1,200 HP
            goobrawl: "always",         // daily goo fight
            phoenix: "always",          // roaming coop boss, weak hits, 180k XP, fire weapons
            mvampire: "always",         // Dracul (cave): 240k HP, magical hits; never taken from another player
            fvampire: "always",         // Ms. Dracul (halloween): 240k HP, 875 magical; the warrior tanks her
            jr: "always",               // Jr. (Spooky Town): orange Lolipop Mace on every kill
            greenjr: "always",          // Green Jr. (Spooky Forest): green Lolipop Mace on every kill
            skeletor: "always",         // Skeletor (arena): 1,800 physical hits, see boss.minHitsNonTankBy
            // Giga Crab (main beach, daily): 16,000 physical hits (one kills priest or ranger); see the join settings.
            crabxx: "always",
            franky: "never", icegolem: "never",
            horseman: "never", abtesting: "never",
            graveyard: "always",          // Halloween: zombies/ghouls in Spooky Town's graveyard - Bones
        },
        // "always" only applies once every fighter has reached this level
        minLevel: { phoenix: 40, goobrawl: 20, snowman: 10, graveyard: 40, mvampire: 50, fvampire: 60, jr: 40, greenjr: 40, skeletor: 60 },
        // search: the whole team searches these; engage: fought when met (searched by the scout or the runner).
        search: ["phoenix"],
        engage: ["mvampire", "fvampire", "jr", "greenjr", "skeletor"],
        // Witch's Cipher: the spots per ingredient (highest HP first).
        witchCipher: {
            spots: {
                embercoal: ["gscorpion", "plantoid"],
                frostscale: ["wolfie", "boar", "arcticbee", "iceroamer"],
                gloomfeather: ["ghost", "osnake", "snake", "minimush"],
                verdantspore: ["spider", "croc", "bee", "goo"],
            },
        },
        // The merchant's boss search: these bosses; watch: held until a fighter is near.
        scout: { enabled: true, bosses: ["phoenix", "mvampire", "fvampire", "skeletor", "greenjr"], watch: [] },
        // The runner's bosses (search interval each); solo: bosses it kills alone.
        runner: {
            enabled: true,
            bosses: { mvampire: 20 * 60 * 1000, fvampire: 25 * 60 * 1000, jr: 60 * 60 * 1000, greenjr: 60 * 60 * 1000, skeletor: 20 * 60 * 1000 },
            solo: [],
        },
        // Held for the team; otherwise the finder opens when the solo boss check passes, else waits by the spawn box.
        holdFor: [],
        farmBosses: [], // hunted nonstop
    },

    // Monster Hunts (farming/hunts.js): always hunt these (even if the guide calls them unsafe) / never these.
    hunts: { allow: [], deny: [] },

    // Drops: extra stock to collect even without a wish: { name, copies } (bag + bank, any level).
    drops: { want: [{ name: "armorbox", copies: 50 }] },

    targeting: {
        farm: null, // null = the guide picks; a monster or a list (the first one not too strong/crowded) to test or for a drop
        fallback: "goo",          // used when the progression guide has no answer
        // Rare monsters attacked first when in sight (range: farming/defaults.js).
        rare: { types: ["goldenbat", "cutebee", "tinyp", "wabbit", "pinkgoo", "snowman"] },
    },

    // Cavalry: spots nuked whenever it is ready (the rest: farming/defaults.js).
    cavalry: { targets: [] },

    // Classes: our item names and chosen modes; the thresholds and timings are in classes/<class>/defaults.js.
    classes: {
        priest: {
            // Luck swap: these pieces go on with the luck catch; a piece listed twice fills both slots (two Clover Studs).
            luckSwap: { items: ["mshield", "rabbitsfoot", "wcap", "wattire", "wbreeches", "wgloves", "wshoes", "cloverstud", "cloverstud"] },
        },
        warrior: {
            swordSwap: { names: ["swordofthedead"] }, // Swords of the Dead on targets that die in a few hits
            agitate: {
                monsters: "auto", deny: [], // "auto": decided per farm target; a list forces these kinds; deny excludes
                weapons: "splash",    // "splash": put on the splash weapons; "keep": pull with the usual ones ("/agitate off|swords|splash|chain|splashstream|config" switches the mode at runtime)
                gather: "center",     // "center": walk into the pack, Agitate there, all arrive together; "step": Agitate, then step away
                swords: "stream",     // mode "swords": "stream" = Agitate on every cooldown where we stand (normal combat), "pull" = the pull-point version
                partyMode: "auto", // party: stream only, on the leash, allies' Taunt/Agitate first; "auto" = the solo stream
            },
        },
        mage: {
            blaster: { names: ["gstaff"] }, // the Blaster weapon
        },
    },

    // Elixirs: which one each class drinks; the merchant buys NPC elixirs below min (bag + bank) up to max.
    elixirs: {
        byClass: { priest: "elixirluck", mage: "elixirint0", warrior: "elixirstr0", ranger: "elixirdex0", rogue: "elixirdex0", paladin: "elixirstr0" },
        buy: { elixirluck: { min: 10, max: 30 } },
    },

    // Cave of Many Dreams (cave/cave.js, docs/cave-of-many-dreams.md): the player enters at Dorr and walks the leader.
    // mode "manual": the bot fights only the player's target or attackers - no own travel, pulls or area skills.
    cave: {
        mode: "manual",
        neverFight: ["cave_darkmage"], // never attacked, also when it hits us
    },

    // Items fighters never hand to the merchant; skill ingredients per class.
    supply: {
        keep: ["tracker"],
        keepByClass: { priest: ["essenceoflife"], ranger: ["poison"] },
    },

    // Fighters' gear (gear/): never equipped automatically (taken off when worn), never put on below a level, at most
    // this many worn at once.
    gear: {
        noEquip: ["handofmidas"],
        minLevel: { mcape: 7, hpants: 7 },
        maxWorn: { zapper: 1 },
    },

    // =================================================================
    // Gear plan: the ONE place for our gear progression. Class wishes are built from `wishes` (chainsFor, called by
    // gear/) and `equivalent`; scripts/gear-plan-guide.mjs renders the block as docs/gear-guide/gear-plan.pdf.
    // Items: "{stat}" = the class's main stat (str/int/dex). `for`: a class or a group.
    // =================================================================
    gearPlan: {
        version: "2.0",
        updated: "2026-11-22",
        about: "General gear progression rules the bot follows. Derived from the community chart and our own decisions.",
        principles: [
            "Every slot has a ladder: base -> better pieces -> end goal. Each step has a target upgrade level.",
            "Keep upgrading instead of waiting: the worn piece goes up to its cap until the next step is in hand.",
            "The game's progression valuation decides what is better (the bot's equip pass already uses it). The plan only says what to wish for and what stands in.",
            "A missing item is replaced by its stand-in (e.g. green Lolipop Mace for the orange one).",
            "Wish: shop, craft and farmable drops are pursued actively. Found: event and boss items are worn when we have them, never chased.",
            "Item stages: an item goes up level by level across the team - e.g. STR rings +4 are wished only once every STR-ring wish at +3 is fulfilled. Different items never block each other.",
            "A worn alternative pauses the ladder of its slot: while e.g. a Loaded Die is worn, no class orb is built.",
            "Shop weapons stop at +8 and only while no better copy is there (a worn Fiery Blade +7 already beats a Blade +8: 54 + burn vs 50). Above that the fire weapon ladder is the way up.",
            "Wanderer's set: each piece has the stats of the shop piece of its slot plus a little (cap +120 HP, attire +80 MP, breeches +1 speed) and the set bonus (2: +200 HP, 3: +100 MP, 4: +10% gold, 5: +16 luck). Only the chest opener (priest) runs it (2026-11-23): it wishes its pieces actively (2026-11-20); once its Wanderer goals are done, spare copies are sold.",
        ],
        decisions: {
            "2026-11-19": [
                "Elixirs: not for now.",
                "Dagger of the Dead may be crafted from Bones for the rogue; it joins the weapon ladder.",
                "Jewelry (rings, earrings, amulets, belts) to +4 with item stages.",
                "Wanderer's set runs in parallel with the shop armor (drops only, no spare copies kept).",
                "No risk floors and no grace preparation.",
                "The merchant works on wishes by value (gain per gold / per hour).",
                "Winged Boots built to +7 (rare scrolls from +8).",
                "The warrior stays on Fiery Blades (no Swords of the Dead).",
                "Shop weapons run through the stages with the armor: everything to +7 first, then +8.",
            ],
            "2026-11-20": [
                "The fighter with the highest gold bonus opens the party's chests (the opener's gold multiplier counts for the whole chest).",
                "The priest (our opener) wishes Wanderer's Attire, Breeches and Gloves +8 once its shop gear is done - with the cap +10% gold. Bases from Ponty; never a stat loss (delivered only at +8).",
                "Wanderer's Shoes +8 stand in for the Winged Boots on the priest (full set: +16 luck); finished Winged Boots replace them.",
                "Shop gear and armor take the High scroll from +5 -> +6 on.",
                "Stages are team-wide: everyone's shop gear to +7, then everyone to +8.",
                "Weapon wishes and Ponty finds only for the weapon types of the class's plan.",
            ],
            "2026-11-23": [
                "Wanderer's set only for the priest (chest opener, luck catch); spare copies are sold once its goals are done.",
                "Rugged +0 copies nobody wears and nobody wishes are sold (e.g. Rugged Coats after the warrior's Dracul's Attire).",
            ],
        },
        groups: {
            physical: ["warrior", "ranger", "rogue", "paladin"],
            caster: ["mage", "priest"],
            tank: ["warrior", "paladin"],
            nontank: ["ranger", "priest", "rogue", "mage"],
            opener: ["priest"], // the chest opener and luck catcher: the only class on the Wanderer's set
        },
        // Class wish chains for one class ({ name, level } or { steps: [...], replace, anytime, ... }); used by gear/ classChains.
        chainsFor: function (ctype, mainStat) {
            const groups = this.groups;
            const inGroup = function (f) {
                if (!f) return true;
                return (Array.isArray(f) ? f : [f]).some(function (x) { return x === ctype || (groups[x] || []).includes(ctype); });
            };
            const res = function (n) { return n.replace('{stat}', mainStat || ''); };
            return this.wishes.filter(function (w) { return inGroup(w.for); }).map(function (w) {
                if (w.single) return { name: res(w.item), level: w.to };
                let steps;
                if (w.steps) steps = w.steps.map(function (s) { return { name: res(s[0]), level: s[1] }; });
                else {
                    steps = [];
                    for (let l = (w.from != null ? w.from : w.to); l <= w.to; l++) steps.push({ name: res(w.item), level: l });
                }
                const e = { steps: steps };
                if (w.replace) e.replace = true;
                if (w.anytime) e.anytime = true;
                const alts = (w.alts || []).filter(function (a) { return inGroup(a.for); }).map(function (a) { return a.item; });
                if (alts.length) e.alts = alts;
                if (w.carry) e.carry = true;
                if (w.count) e.count = w.count;
                if (w.insteadOf) e.insteadOf = w.insteadOf;
                if (w.slots) e.slots = w.slots;
                return e;
            });
        },
        caps: { armor: 8, weapon: 9 }, // for the gear plan PDF only (scripts/gear-plan-guide.mjs); the bot uses workshop.gearGoals
        // Weapon lists, worst to best: the merchant upgrades the last item we hold while a step beats the weaker worn weapon
        // (util.weaponPower), else the one before it. The front shop weapon: gear goals; material weapons: materialGoals.
        weapons: {
            warrior: ["blade", "swordofthedead", "fireblade"],
            priest: ["staff", "firestaff", "staffofthedead"],
            ranger: ["bow", "hbow", "firebow", "crossbow"],
            rogue: ["stinger", "daggerofthedead"],
            // The Blaster is carried (wishes below), not listed; with burn the Fiery Staff beats the Staff of the Dead.
            mage: ["staff", "staffofthedead", "firestaff"],
        },
        // Highest level the list items are upgraded to (per item, else default).
        weaponCaps: { default: 7, fireblade: 8, firestaff: 8, firebow: 8 },
        // Shop armor per slot: gear goals push the worn piece through workshop.gearGoals.stages - no wish needed.
        shop: { helmet: "helmet", chest: "coat", pants: "pants", shoes: "shoes", gloves: "gloves" },
        // A piece that replaces the worn shop piece of its slot at the same level or higher.
        equivalent: { wcap: "helmet", wattire: "coat", wbreeches: "pants", wshoes: "shoes", wgloves: "gloves" },
        // Equivalents run with the armor goals for this group (built to the worn shop piece's level, then replace it).
        parallel: "opener",
        // ...and crafted only when every ingredient is in stock (never a reason to farm; market.buy keeps materials coming).
        craftFromStock: ["wcap", "wattire", "wbreeches", "wgloves", "wshoes"],
        // Wish chains, in wish order. `item` + `to` (and `from`: one step per level from..to) or
        // `steps`: [[item, level], ...]. replace: worn over pieces outside the chain; anytime: not
        // only after the shop gear is done; alts: worn alternatives pause the chain; carry: kept
        // in the bag for a mode (count copies, insteadOf: stand-in for another carried item).
        wishes: [
            { slot: "cape", item: "cape", to: 0, single: true, how: "exchange: 40 Leather" },
            // Tanks take the Winged Boots after their Rugged Shoes +8 (tank shoes chain below).
            { slot: "shoes", item: "wingedboots", to: 7, replace: true, for: "nontank", how: "craft: Shoes + 20 Magical Feathers" },
            { slot: "offhand", steps: [["quiver", 0], ["quiver", 7], ["quiver", 8]], for: "ranger", how: "craft: Armadillo Scale + 200 Bee Wings" },
            { slot: "orb", steps: [["orbg", 0], ["orbg", 1], ["orbof{stat}", 0]], alts: [{ item: "cave_loaded_die", how: "craft: 10 Cave Amber + 8 Seashells + 2 Reef Glass" }], how: "craft (Cole)" },
            // Rings: main-stat rings +2 -> +4, then the crafted seals +2 (12 main stat vs 10). Sucker Punch: ranger only.
            { slot: "ring", item: "{stat}ring", from: 2, to: 4, replace: true, anytime: true, for: ["ranger", "rogue", "mage", "paladin"],
                alts: [{ item: "suckerpunch", for: "ranger", how: "drop: crabs" }] },
            { slot: "ring", steps: [["strring", 2], ["strring", 3], ["strring", 4], ["emberseal", 2]], replace: true, anytime: true, for: "warrior",
                how: "craft: STR ring +2 + ember core + 6 essence of fire" },
            { slot: "ring", steps: [["intring", 2], ["intring", 3], ["intring", 4], ["glacierseal", 2]], replace: true, anytime: true, for: "priest",
                how: "craft: INT ring +2 + frost core + 6 essence of frost" },
            { slot: "earring", item: "{stat}earring", from: 2, to: 4, replace: true, anytime: true, for: ["warrior", "ranger", "rogue", "mage", "paladin"] },
            // Moonshard +2: 12.5 INT + 160 MP (an INT earring +4 has 11).
            { slot: "earring", steps: [["intearring", 2], ["intearring", 3], ["intearring", 4], ["moonshardearring", 2]], replace: true, anytime: true, for: "priest",
                how: "craft: INT earring +2 + 8 void thread + 40 bat wings + 4 essence of ether" },
            { slot: "amulet", item: "{stat}amulet", from: 2, to: 4, replace: true, anytime: true },
            { slot: "belt", item: "{stat}belt", from: 0, to: 4, replace: true, anytime: true, how: "map drop: Spooky Town", for: ["warrior", "priest", "rogue", "mage", "paladin"],
                alts: [{ item: "knifebelt", for: "rogue", how: "craft - gives Fan of Knives" }] },
            // Ranger: DEX belt +4, then the Wind Belt +2 (16 DEX like the belt +4, plus armor and speed).
            { slot: "belt", steps: [["dexbelt", 0], ["dexbelt", 1], ["dexbelt", 2], ["dexbelt", 3], ["dexbelt", 4], ["windbelt", 2]], replace: true, anytime: true, for: "ranger",
                how: "craft: DEX belt +2 + 40 storm feathers + 4 essence of ether" },
            // Tanks: Rugged set from armor boxes, +7 then +8, worn over the shop piece once the shop gear is done.
            { slot: "helmet", steps: [["helmet1", 7], ["helmet1", 8]], replace: true, for: "tank", how: "armor box" },
            { slot: "pants", steps: [["pants1", 7], ["pants1", 8]], replace: true, for: "tank", how: "armor box" },
            // Warrior gloves: Rugged +8, then the Fiery Gloves (+7, then +8 - never more than one level below).
            { slot: "gloves", steps: [["gloves1", 7], ["gloves1", 8], ["fierygloves", 7], ["fierygloves", 8]], replace: true, for: "warrior",
                how: "armor box / craft: gloves + 20 feathers + 2 essence of fire" },
            { slot: "gloves", steps: [["gloves1", 7], ["gloves1", 8]], replace: true, for: "paladin", how: "armor box" },
            // Warrior chest: Rugged +7, then Dracul's Attire from +7 (no stat drop below +7), then +8 slowly
            // (workshop.dailyTries). No Rugged Coat +8 - the Attire replaces it.
            { slot: "chest", steps: [["coat1", 7], ["mcape", 7], ["mcape", 8]], replace: true, for: "warrior", how: "armor box / drop: Dracul, Ms. Dracul" },
            { slot: "chest", steps: [["coat1", 7], ["coat1", 8]], replace: true, for: "paladin", how: "armor box" },
            { slot: "shoes", steps: [["shoes1", 7], ["shoes1", 8], ["wingedboots", 7]], replace: true, for: "tank", how: "armor box / craft: shoes + 20 magical feathers" },
            // Priest (chest opener): Wanderer's pieces +8 once its shop gear is done; the shoes stand in for Winged Boots.
            { slot: "chest", item: "wattire", to: 8, replace: true, for: "priest", how: "Ponty / craft" },
            { slot: "pants", item: "wbreeches", to: 8, replace: true, for: "priest", how: "Ponty / craft" },
            { slot: "gloves", steps: [["wgloves", 8], ["fierygloves", 7], ["fierygloves", 8]], replace: true, for: "priest", how: "Ponty / craft" },
            // Ranger gloves: Thundergrips, crafted from Gloves of the Hunter Ranger +6 (8 Monster Tokens).
            { slot: "gloves", steps: [["thundergrips", 7], ["thundergrips", 8]], replace: true, for: "ranger",
                how: "craft: hunter gloves +6 + 80 storm feathers + 12 essence of ether" },
            // Priest luck swap set: carried, never worn by the equip pass - classes.priest.luckSwap puts them on.
            { slot: "orb", item: "rabbitsfoot", to: 0, carry: true, for: "priest", how: "120 Fun Tokens" },
            { slot: "offhand", item: "mshield", to: 7, carry: true, for: "priest", how: "10 Fun Tokens (after the Rabbit's Foot: workshop.tokenOrder)" },
            { slot: "earring", item: "cloverstud", to: 0, carry: true, count: 2, for: "priest", how: "craft: vit earring +2 + verdant core + 40 ash leaf + 40 spores + 5 green slime (x2, one per earring slot)" },
            // Ranger AoE: Poucher and Alloy Quiver are held in the bag for a later AoE mode.
            { slot: "mainhand", item: "pouchbow", to: 7, carry: true, for: "ranger", how: "craft: bow + Pouch of Poof" },
            { slot: "offhand", item: "alloyquiver", to: 0, carry: true, for: "ranger", how: "drop: targetrons 1:4,000" },
            { slot: "shoes", item: "wshoes", to: 8, replace: true, for: "priest", how: "Ponty / craft",
                alts: [{ item: "wingedboots", how: "craft: Shoes + 20 Magical Feathers" }] },
            // Warrior Agitate mode: two orange Lolipop Maces carried; green ones stand in (weapons: gearPlan.weapons).
            { slot: "mainhand", item: "ololipop", to: 7, carry: true, count: 2, for: "warrior", how: "drop: Jr." },
            { slot: "mainhand", item: "glolipop", to: 7, carry: true, count: 2, insteadOf: "ololipop", for: "warrior", how: "drop: Green Jr." },
            // Mage Blaster (classes.mage.blaster), carried. to: 0 - upgraded by hand with Primlings, never by the workshop.
            { slot: "mainhand", item: "gstaff", to: 0, carry: true, for: "mage", how: "craft: staff +8 + Essence of Greed (crafted 2026-11-23)" },
        ],
        // Not wished: worn when we have them and the valuation rates them higher.
        found: {
            helmet: [{ item: "fury", for: "physical" }, { item: "xhelmet" }],
            chest: [{ item: "tshirt9" }, { item: "vattire", for: "caster" }, { item: "cdragon", for: "tank" }],
            pants: [{ item: "fallen", for: ["warrior", "rogue"] }, { item: "starkillers", for: "caster" }],
            shoes: [{ item: "wshoes", for: "nontank" }],
            gloves: [{ item: "supermittens" }, { item: "mpxgloves", for: ["paladin", "priest", "rogue"] }],
            cape: [{ item: "horsecape" }, { item: "ecape" }, { item: "vcape" }, { item: "gcape", for: "priest" }],
            earring: [{ item: "cearring" }, { item: "moonshardearring", for: "mage" }, { item: "frostfang" }, { item: "molesteeth" }],
            ring: [{ item: "cring", for: "caster" }, { item: "zapper", for: "priest" }, { item: "vring", for: "warrior" }, { item: "emberseal", for: "paladin" }],
            amulet: [{ item: "mpxamulet", for: ["paladin", "rogue"] }, { item: "keepsakependant", for: "paladin" }, { item: "gloampendant", for: "rogue" }],
            belt: [],
            orb: [{ item: "rabbitsfoot", for: "priest" }],
        },
        // Documentation only - the bot follows config.elixirs.
        elixirs: { off: true, note: "Superseded by config.elixirs (2026-11-23): Liquid Luck for the priest, main stat tier 0 for the others.", options: [{ item: "pumpkinspice", for: "physical" }, { item: "elixirluck", for: "priest" }] },
        // Weapons per class (PDF documentation); the bot rates guide weapon wishes and Ponty finds only for these types.
        classes: {
            warrior: {
                modes: {
                    single: { mainhand: [["blade", 8], ["swordofthedead", 7], ["fireblade", 9]], offhand: [["blade", 8], ["swordofthedead", 7], ["fireblade", 9]] },
                    aoe: { mainhand: [["glolipop", 7], ["ololipop", 7], ["vhammer", null, "found"]], offhand: [["glolipop", 7], ["ololipop", 7]],
                        note: "Missing Vampiric Hammer: a second Lolipop. Missing orange Lolipop: the green one." },
                },
                rules: ["Tank armor: Rugged set +7 replaces the shop pieces (2026-11-16).", "HP belt only while no STR belt is there.", "Swords of the Dead +5/+6/+7 as steps until the Fiery Blades +7 (2026-11-21; was: no Swords of the Dead, 2026-11-19)."],
            },
            ranger: {
                modes: {
                    single: { mainhand: [["bow", 8], ["hbow", null, "craft"], ["firebow", 7], ["crossbow", null, "found"]], offhand: [["quiver", 8], ["t2quiver", null, "found"]] },
                    aoe: { mainhand: [["pouchbow", 7, "craft"]], offhand: [["alloyquiver", null, "found"]], note: "Held in the bag for a later AoE mode." },
                },
            },
            priest: {
                modes: {
                    single: { mainhand: [["staff", 8], ["firestaff", 7], ["staffofthedead", 7], ["lmace", null, "found"]], offhand: [["wbook0", 2]],
                        note: "Shield M, Rabbit's Foot, the Wanderer's set and a Clover Stud are the luck swap set (classes.priest.luckSwap)." },
                },
            },
            rogue: {
                modes: {
                    single: { mainhand: [["stinger", 7], ["daggerofthedead", 7, "craft"], ["vdagger", null, "found"]], offhand: [["stinger", 7], ["daggerofthedead", 7, "craft"], ["vdagger", null, "found"]],
                        note: "First the main hand, then the offhand; spares climb the weapon ladder." },
                },
                rules: ["Knife Belt as soon as it can be crafted: it unlocks Fan of Knives."],
            },
            mage: {
                modes: {
                    single: { mainhand: [["staff", 8], ["firestaff", 9]], offhand: [["wbook0", 4]] },
                    aoe: { mainhand: [["gstaff", 3, "craft"], ["sparkstaff", null, "found"]], offhand: [] }, // the Blaster takes both hands
                },
            },
            paladin: {
                modes: {
                    single: { mainhand: [["mace", 8], ["maceofthedead", 9, "craft"], ["concordmace", 9]], offhand: [["wshield", 6], ["cave_counterweight", 7, "craft"]] },
                    aoe: { mainhand: [["glolipop", 7], ["ololipop", 7], ["vhammer", null, "found"]], offhand: [["wshield", 6], ["exoarm", null, "found"]] },
                },
                rules: ["Tank armor: Rugged set +7 like the warrior."],
            },
        },
    },

    // Merchant: fulfil wishes from bag, bank or by upgrading own copies. Ours: risk floors, budgets, item lists, goals
    // (the tuning is in roles/workshop/defaults.js).
    workshop: {
        // Minimum success chance per upgrade step, by how the item is replaced (0: a failure only costs the attempt).
        risk: {
            shop: 0,               // re-buyable from an NPC
            compound: 0,           // compound items (three copies from drops)
            rare: 0,               // token / drop items (Hunter set, Phoenix weapons, ...)
            graceWindow: 0.25,     // grace farming only when the chance is at most this far below the floor
            // No floor (like shop gear): copies come from boxes we hold in numbers.
            free: ["helmet1", "gloves1", "pants1", "coat1", "shoes1",
                "ololipop", "glolipop"], // Lolipop Maces up to +7 like shop gear: (Green) Jr. drops one or two per kill
            maxScrollGrade: 2,     // try up to Rare scrolls when the normal one falls short
            // Only with scrollChoice off: the High scroll from this level (drop weapons / shop gear and armor).
            higherScrollFrom: 5,
            gearHighScrollFrom: 5,
            buyStrongerScrolls: true, // only within budgetPerWish; owned/banked ones are used first
        },
        // Gold per wish (base item + scrolls, failures included): shop gear vs token/drop items; byItem per item.
        budgetPerWish: {
            shop: 1000000, rare: 4000000,
            byItem: { wattire: 8000000, wbreeches: 8000000, wgloves: 8000000, wshoes: 8000000 },
        },
        // Grace farming (off): the fodder - a cheap upgradeable shop item no gear goal uses (Wooden Basher, 4,900 gold).
        grace: { enabled: false, fodder: "wbasher" },
        // Ladder pot: income share (last 24 h) for the materialGoals "ladder" budget; optional extra: { amount, until }.
        bruteForce: { incomeShare: 0.25 },
        // Box armor: spare Rugged copies are upgraded towards upTo while wished; sold once nobody needs them.
        boxArmor: { names: ["helmet1", "gloves1", "pants1", "coat1", "shoes1"], upTo: 8 },
        // At most this many upgrade tries per day for "item:level" (rare copies).
        dailyTries: { "mcape:8": 3 },
        // Shared material: a recipe waits while an item listed before it (or a material weapon goal) is still wished.
        materialOrder: { essenceofether: ["thundergrips", "moonshardearring", "windbelt"] },
        tokenOrder: { funtoken: ["rabbitsfoot", "mshield"] }, // token purchases in this order
        // Drop weapons that beat a fighter's worn one. With a gearPlan.weapons list that list rules; names, maxLevel,
        // craft and buy only matter for classes without one.
        betterWeapons: {
            names: ["fireblade", "firestaff", "firebow", "concordmace", "maceofthedead", "staffofthedead", "bowofthedead",
                "daggerofthedead"],
            maxLevel: 7,
            craft: ["daggerofthedead"], // crafted once the fighter's weapon is at gearGoals.upTo
            buy: [],        // bought with tokens when we hold none
            minChance: {},  // per item: chance each upgrade step needs
        },
        // The workshop never spends below share x the merchant's highest gold of the last 24 h (at most max).
        keepGold: { share: 0.2, max: 5000000 },
        // Gear goals: when idle, the merchant pushes worn shop armor and weapons to `upTo` with the main-stat scroll.
        gearGoals: {
            upTo: 8,                  // weapons and the "shop gear done" mark for class wishes
            stages: [7, 8],           // team-wide: every fighter's shop gear reaches a stage before anyone goes on
            capBy: { ranger: { chest: 9 } }, // per-piece caps once the whole team is through the stages
            // offhand: a second shop weapon (dual wield) goes to upTo too; shields, books, quivers stay out.
            slots: ["helmet", "chest", "pants", "shoes", "gloves", "mainhand", "offhand"],
            weapons: [], // drop weapons: materialGoals and gearPlan.weapons
            // The gear pot: incomeShare of the last 24 h of income (minus consumables); everything on gear pays from it.
            budget: {
                incomeShare: 0.7,
                // One-time fresh start of every pot (no effect after 24 h). Optional: extra: { amount, until } on top.
                resetAt: "2026-11-24T00:00:00Z",
            },
        },
        wishes: {}, // fixed wishes on top of the guide's, e.g. DmpxPala: [{ name: "concordmace", level: 4 }]
        compound: {
            autoUpTo: 3,  // auto compounding up to this level (each step still needs the risk tier's chance)
            keep: { "dexbelt:2": 2 }, // copies held back from auto compounding ("name:level": count)
        },
        exchange: {
            items: ["gem0", "gem1", "seashell", "leather"], // seashell only while config.elixirs.exchange asks for it
            // Opened only when a wished item comes out of them.
            onDemand: ["armorbox"],
            // Hoarded, not exchanged or opened (empty the list for a big batch).
            hold: ["gem0", "gem1", "marketparcel", "armorbox"], // + Merrit's parcels
        },
    },

    // Merchant role. Ours: own wishes, the stand's home, what is sold, gifts, the Ponty round, class items, the bank's keep
    // list (the tuning is in roles/merchant/defaults.js).
    merchantRole: {
        // The merchant's own wishes: bought, crafted at Leo or reported as a drop shortage; kept in his bag, never
        // delivered, sold or banked. They come before the fighters' wishes and only keep the potion reserve.
        ownWishes: [
            { name: "stand0" },       // market stand (buy orders, Merrit's parcels)
            { name: "rod" },          // fishing: Rugged pieces
            { name: "pickaxe" },      // mining (later: the Mining Tunnel has moles)
        ],
        // Gathering with the merchant's own tools: the mainland pier by the fisherman (water within 24 px).
        gather: { fishing: { spot: { map: "main", x: -1560, y: 470 } } },
        // Market stand: the merchant's home on the town square with the stand open (buy orders, Merrit's hourly parcel).
        // Upgrade, compound, Xyn, Lucas and the potion shop are within reach; keep 40+ px from fixed NPCs. Orders: market.
        stand: { home: { x: -120, y: -112 } },
        goldReserve: { ratio: 0.2, min: 0, max: 1000000 }, // never spend below 20% of our gold (max 1M)
        // A plain name sells +0 copies, { name, maxLevel } up to that level. Never listed: Phoenix/event weapons, craft or
        // Witch's Cipher ingredients, Short Swords, Rugged/Heavy armor, accessories and books other than HP/VIT ones.
        sellList: [
            "slimestaff", "mushroomstaff",
            { name: "stinger", maxLevel: 2 }, // +3 and up are rogue daggers
            // Wanderer's set: sold only when no fighter can use the copy (workshop.equivalentWanted).
            "wcap", "wshoes", "wattire", "wbreeches", "wgloves",
            "snowball",
            { name: "hpamulet", maxLevel: 10 },
            { name: "vitring", maxLevel: 10 },  // STR beats VIT for the warrior too
            { name: "hpbelt", maxLevel: 10 },   // stat belts replace them; a worn copy stays
            { name: "helmet", maxLevel: 3 },
            // Shop weapons and the old quiver that did their job; a copy anyone wishes for is never sold (isReserved).
            { name: "mace", maxLevel: 7 },
            { name: "staff", maxLevel: 7 },
            { name: "blade", maxLevel: 5 },
            { name: "quiver", maxLevel: 2 },
            // Materials without a plan.
            "rattail", "smush",
            // Full bank (player decision 2026-11-25): Crab Claw and Reed Scythe weapons +0; the green Lolipop Maces +0 only
            // while no fighter wishes them (the warrior holds the orange ones, which stand above the green - isReserved).
            "cclaw", "cave_reedscythe", "glolipop",
            "dawnwardaegis", // Skeletor drop, paladin-only shield
            "vitscroll", "lspores", // VIT stat scrolls (we use STR/INT/DEX; the shop sells them), Large Spores
        ],
        // Items the merchant hands to a fighter on its next delivery (one-off gifts).
        give: {
        },
        // Every online fighter gets one if it carries none - from the bank, else bought with tokens (Tracktrix: 4 at Daisy).
        onePerCharacter: ["tracker"],
        onePerCharacterKeepOwn: false, // the merchant keeps no copy for itself
        // Ponty round over other servers (main.js hop watcher): every everyHours full local hours (0 = off) and once at
        // testAt the merchant serves every fighter, banks, visits Ponty on each server and comes home.
        pontyRound: {
            enabled: true,
            // Home = the leader's server (util.teamServer); this one only until the leader's first heartbeat is stored.
            home: ["EU", "III"],
            // Every server, PvP ones too (worth the risk); the home server is skipped automatically.
            servers: [["EU", "I"], ["EU", "II"], ["EU", "III"], ["EU", "IV"], ["US", "I"], ["US", "II"], ["US", "III"], ["US", "IV"], ["US", "V"], ["ASIA", "I"], ["ASIA", "II"],
                ["EU", "PVP"], ["US", "PVP"]],
            // Every hop ends a Lost and Found (Ron) access; hourly rounds mostly found nothing new.
            everyHours: 3,                     // every third full hour local time (0, 3, 6 ... o'clock)
            testAt: null,                      // one extra round at this ISO time
        },
        classItems: { priest: ["essenceoflife"], ranger: ["poison"] }, // skill ingredients, sent with every delivery
        // Kept in the bag, never banked.
        bank: {
            keep: [
                "tracker",
                "scroll0", "scroll1", "scroll2", "cscroll0", "cscroll1", "cscroll2",
                "essenceoflife", "poison", // skill ingredients for priests / rangers
                "stand0", "stand1",        // the market stand stays in the bag
                "rod", "pickaxe",          // the merchant's tools stay in the bag
            ],
        },
    },
};

// The tuning from the modules' defaults.js files (stage 7b), filled in where config.js has no value of its own.
const DEFAULTS = [
    require("./defaults.js"),          // main: watchdog, ui
    require("./travel/defaults.js"),   // travel tuning, movement
    require("./team/defaults.js"),     // party
    require("./combat/defaults.js"),   // meter, tickMs, combat, potions
    require("./encounters/defaults.js"), // events tuning
    require("./safety/defaults.js"),   // targeting: team safety, isolation, spot check, hit factor, mobbing, rage, live
    require("./farming/defaults.js"),  // hunts, drops, targeting (farm choice, crowded, occupied), cavalry
    require("./cave/defaults.js"),     // cave recorder
    require("./supply/defaults.js"),   // supply, elixir rules
    require("./classes/paladin/defaults.js"),
    require("./classes/priest/defaults.js"),
    require("./classes/rogue/defaults.js"),
    require("./classes/ranger/defaults.js"),
    require("./classes/warrior/defaults.js"),
    require("./classes/mage/defaults.js"),
    require("./gear/defaults.js"),     // fighters' gear
    require("./roles/workshop/defaults.js"),
    require("./roles/merchant/defaults.js"),
];
DEFAULTS.forEach(function (d) { fillDefaults(config, d); });

// Deep fill: a key we don't have takes the default (a copy); two plain objects are filled key by key; anything else we
// have (a value, an array, null) stays as it is.
function fillDefaults(ours, defaults) {
    Object.keys(defaults).forEach(function (k) {
        const d = defaults[k];
        if (!(k in ours)) ours[k] = copyDefault(d);
        else if (isPlain(ours[k]) && isPlain(d)) fillDefaults(ours[k], d);
    });
    return ours;
}
function isPlain(v) { return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof RegExp); }
function copyDefault(v) {
    if (Array.isArray(v)) return v.map(copyDefault);
    if (isPlain(v)) { const o = {}; Object.keys(v).forEach(function (k) { o[k] = copyDefault(v[k]); }); return o; }
    return v;
}

module.exports = config;
