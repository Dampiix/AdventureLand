// =====================================================================
// bot_config - everything you are expected to tweak lives here.
//
// To run a different team (e.g. brand-new level-1 characters) only the
// `team` block needs to change. Classes come from character.ctype, so any
// class works; warrior, paladin, priest, rogue, mage and ranger have skill modules.
// =====================================================================

module.exports = {
    version: "1.223.5",

    team: {
        // Fresh save (2026-11-15). The old characters DampiixWar, Dampiix, DampiixPri and
        // Dampiiix are an item archive: never list them here, the bot would hand their
        // items to the merchant.
        // 2026-11-16: the paladin DmpxPala is replaced by the warrior DmpxWar (taunt, cleave).
        // Party since 2026-11-16: the priest leads (picks the spots, ranged), the warrior
        // tanks with Taunt.
        // Solo 2026-11-16 to 2026-11-17 (XP test: the warrior alone with Lone Wolf made 24.3M XP
        // in 30 min, the whole party 16.2M): the warrior levelled ahead as the tank (59 -> 64).
        // Party again since 2026-11-17 (booboos and wolves now pass the team check).
        // Solo again 2026-11-17: the warrior hunts the Phoenix nonstop with Lone Wolf for fire
        // weapons (firebow for the ranger). Party again 2026-11-17 for the firebow handover.
        // Solo again 2026-11-17: test run of the warrior alone on CGoos (Tiny Rubies).
        // Party again 2026-11-17: White Wolves to test the lone pulls.
        // Solo again 2026-11-17 (afternoon): the warrior hunts the Phoenix nonstop for firebows.
        // Party again 2026-11-17 (evening): normal farming and the Goo Brawl together.
        // Solo again 2026-11-17 (night): nonstop Phoenix to test config.dismantle (essence).
        // Party again 2026-11-18 (evening): Agitate with the team at the bats, the ranger
        // collects his gear. Solo: leader "DmpxWar", phase "solo".
        leader: "DmpxPriest",
        fighters: ["DmpxPriest", "DmpxWar", "DmpxRanger", "DmpxRogue"],
        // Fighters outside the party: not invited, not started by the leader (only three fighters
        // may be online). 2026-11-18 (late): the rogue joins the party for booboos and belts, the
        // ranger pauses. Before: the new rogue levelled on its own.
        solo: ["DmpxRogue"], // 2026-11-19: the ranger back in the party (booboo belts, level 60); the rogue solos tomorrow
        merchant: "DampiixMerch",                       // null for no merchant
        farm: {},                                       // optional per-character farm override, e.g. { DmpxRanger: "bee" }
    },
    // Other accounts running this same code (util.deriveTeam picks the team that lists the
    // running character). Fresh account "Viz" (2026-11-19, Europas III): a real start from
    // zero - no bank, no gold - to see how the bot progresses on its own. Only one account is
    // played at a time.
    otherTeams: [
        // Solo 2026-11-21 (evening, player decision): the warrior alone with Lone Wolf x Welcome Back,
        // Daisy hunts off, boss searches stay. Party again: leader "VizPri", phase "party", hunts on.
        // Party again 2026-11-21 (late evening, player): the team clears the grown CGoos (level 26) in the
        // arena (targeting.farm "cgoo"), then the warrior goes solo again.
        // Solo again 2026-11-21 (night): the warrior alone with Lone Wolf (no fixed farm target).
        { name: "viz", leader: "VizPri", fighters: ["VizPri", "VizWar", "VizRng"], solo: [], merchant: "VizMerch", farm: {} },
    ],

    // Market stand (player decision 2026-11-17): what the merchant buys and sells at his stand.
    //   buy:  { item, price, want, level? }  - a buy order for what is missing up to "want"
    //         (bag + bank are counted); level for upgradeable items, default +0.
    //   sell: { item, price, keep, level? }  - everything above "keep" is offered; items in
    //         the bank are fetched on the next bank trip. Wished items are never sold.
    // Prices per unit in gold. The stand has 16 slots for both (24 from merchant level 70, 30 from 80).
    market: {
        buy: [
            // Standing orders for the Wanderer's set materials (player decision 2026-11-19): about 3x
            // the NPC value; they keep the stand open for Merrit's parcels as well.
            { item: "beewings",      price:     75, want: 600 },
            { item: "crabclaw",      price:    360, want: 300 },
            { item: "spores",        price:    360, want: 200 },
            { item: "gslime",        price:     60, want: 100 },
            { item: "frogt",         price:     10, want: 10  },
            { item: "essenceoffire", price: 140000, want: 10 }, // = a fire weapon (+ shop weapon, 20k at Leo)
            { item: "ololipop",      price: 150000, want: 4  }, // orange Lolipop Mace (a player pays 300k)
            { item: "glolipop",      price:  80000, want: 4  }, // green one as a stand-in
            { item: "offeringp",     price: 350000, want: 2  }, // Primling
            { item: "crossbow",      price: 400000, want: 1  }, // the ranger's long-term bow
        ],
        sell: [
            { item: "leather",       price:  120000, keep: 0 }, // a player buys at 100k
            { item: "snakefang",     price: 3500000, keep: 0 }, // a player buys at 3M
            // Monster Tokens are no longer sold (player decision 2026-11-22): they are saved for the Monster
            // Hunter armor sets at Daisy (53 tokens per class). Was: 1M at our stand, max 20 at a time.
        ],
        // Selling into other players' buy orders on any server (player decision 2026-11-20): every
        // scanEveryMs the game's merchant list is checked; a buy order at minPrice or more for
        // everything above "keep" (bag + bank) starts a trip to that stand (server hop if needed).
        // buyFromPlayers (player decision 2026-11-20): with the same scan, what Ponty would buy
        // (wishes, gear goals, finds - market.ponty rules) is bought from players' stands too.
        sellTo: {
            enabled: true,
            // Every 20 min (player decision 2026-11-20, was 5): every trip restarts the merchant twice (hop
            // out and home) and its work list starts over - jobs at the end of it never came up.
            scanEveryMs: 20 * 60 * 1000,
            // Items without a known own cost (drops) are capped by the pot share only - an orange
            // Lolipop +0 went for 1M; fine for an endgame piece (player decision 2026-11-20), so the
            // pot share went from 0.5 to 0.2 (market.ponty) instead of a price rule.
            buyFromPlayers: true,
            items: [
                // Market check on aldata (player decision 2026-11-20): Monster Tokens down to 700k (more
                // buyers: Ploob 900k, EadroSell 700k), Fun Tokens added (bids 1-1.5M, nothing in the Fun
                // Token shop is worth it for us). Void Thread and Bat Wings are kept: the rogue's Knife
                // Belt (Fan of Knives) needs them.
                // Monster Tokens: not sold any more (2026-11-22, saved for the Monster Hunter sets).
                // Fun Tokens: not sold any more either (player decision 2026-11-22).
                // Vitality earrings by level (player decision 2026-11-20; Phoenix drop, 12 %): +0 sold while
                // a buyer pays 500k+; without one for demandHours the workshop compounds them (+1 in
                // between is never sold) up to +2, the highest level here - stock for +2 buyers (10-15M).
                { item: "vitearring", level: 0, minPrice: 500000, keep: 0, demandHours: 3 },
                // keep 1 (2026-11-22, gear plan v2): the priest's Clover Stud is crafted from an Earring of Vitality +2.
                { item: "vitearring", level: 2, minPrice: 8000000, keep: 2 }, // two Clover Studs (2026-11-23)
            ],
        },
        // Buy orders for what we wish (player idea 2026-11-19): one copy of every wished item / gear
        // goal at its level, priced at priceShare of our own expected cost (two digits), only when
        // funded and at most maxShareOfPot of the gear pot; not for +0 NPC stock; taken down once we
        // hold such a copy. Keeps the stand open for Merrit's parcels with orders worth filling.
        // OFF since 2026-11-20 (player decision): ownCost valued drop hours with gold/hour from a
        // 24 h window holding the 45M token sale - orbg +0 went for 9.9M, ringsj +1 for 6.3M.
        // ON again since 2026-11-20 (v1.147.0, player decision) with the new price rule: drop hours
        // count at the opportunity cost - team gold/hour on the spot we really farm minus the drop
        // spot's (guide `net`, never below 0) - and a filled order is paid from the gear pot.
        // priceShare 1.2 (player decision 2026-11-20): a bought copy saves the waiting time, worth
        // 20 % on top of our own cost - the same rule as Ponty's maxShareOfOwn.
        wishOrders: { enabled: true, priceShare: 1.2, maxShareOfPot: 0.2, minPrice: 1000, max: 8 }, // pot share 0.5 -> 0.2 (2026-11-20)
        // Ponty (player request 2026-11-19, fresh account): every everyMs the merchant checks his
        // listings and buys what a fighter wishes or a gear goal needs - better than our best copy
        // and at most maxShareOfOwn of what making it ourselves would cost. From the gear pot.
        // Rules (player decisions 2026-11-19): at most maxShareOfOwn of our own expected cost (up to
        // 20 % more - the time saved is worth it) and at most maxShareOfPot of the gear pot per purchase
        // (50 %: one purchase never takes the whole pot; it grows with the income; was a fixed 1M). reportFinds: pieces outside the wish
        // list are reported (gain per gold vs our best own upgrade); buyFinds (player decision
        // 2026-11-19): the best one worth it is bought as well (pot share, main-stat scroll, delivered).
        // Wished drops no NPC sells (lollipops, drop rings): lower levels are bought as bases to
        // upgrade - up to the wish count, or the copies a compound still lacks (2026-11-19).
        // maxShareOfPot 0.2 since 2026-11-20 (player decision, was 0.5): a bad buy never takes more
        // than a fifth of the gear pot - this rule also caps buys from players' stands.
        ponty: { enabled: true, everyMs: 20 * 60 * 1000, maxShareOfOwn: 1.2, maxShareOfPot: 0.2, reportFinds: true, buyFinds: true, findMinGain: 0.5 },
    },

    // Dismantle drops (player decision 2026-11-17): instead of upgrading them, the merchant
    // takes every spare copy of these items (up to maxLevel) to Leo and dismantles it into
    // its material - a fire weapon gives one Essence of Fire (10k, any level). The material
    // stacks in one bank slot; weapons are crafted from it when we want them (shop weapon +
    // essence + 20k at Leo); see materialGoals.
    // Never dismantled: worn, wished or earmarked copies, a copy readied for a fighter
    // (betterWeapons), locked or titled copies, and copies up to a market.buy "want".
    dismantle: {
        enabled: true,
        // of-the-Dead weapons into Bones (player decision 2026-11-19) - except the Sword of the Dead:
        // its base (Short Sword) only comes from weapon boxes, so it can't be rebuilt. The Staff of the Dead
        // stays too since 2026-11-21: the priest's end goal (bases from Ponty).
        names: ["fireblade", "firestaff", "firebow",
            "maceofthedead", "bowofthedead", "daggerofthedead", "staffofthedead"], // Spear and Hand of the Dead stay since 2026-11-21 (worth more sold than as Bones)
        // Staff of the Dead (2026-11-21): +0 copies once no weapon list wants them, or while its Bones wait for a
        // higher list priority - like fire weapons and essence. The Sword of the Dead stays off this list: its
        // Short Sword is rare, so held copies are always upgraded and never turned into Bones.
        maxLevel: 0, // +1 and higher copies stay (they would only give one essence as well)
    },

    // Material goals (player decision 2026-11-22; were the essence goals of 2026-11-18): weapons crafted from a
    // dismantled material - Essence of Fire (fire weapon + shop weapon + 20k at Leo) and Bones (Of-the-Dead
    // weapon + its base + fee) - and pushed up the upgrade ladder, one copy at a time, until the goal level.
    // One set of rules for every material (workshop materialGoals):
    //   goals:   every material item of a fighter's weapon list (gearPlan.weapons) that beats the worn weapon;
    //            priority = its place from the back of the list, the lowest number first; the others wait -
    //            nothing crafted for them, their +0 copies dismantled into material (unless the item is not
    //            on dismantle.names: then held copies are still upgraded). Buying is never held back.
    //   deliver: "better" - the best copy that beats the weaker worn weapon; upgrades go step by step to the
    //            first level that does (the replaced weapon comes back as a base); "goal" - at the goal level.
    //   budget:  "ladder" - the ladder pot (workshop.bruteForce; borrowFrom: the gear goals' pot while they are idle);
    //            "goals" - the gear goals' pot.
    //   upTo:    goal level (else gearPlan.weaponCaps); buyCopies: Ponty / player stands buy copies of its
    //            items as bases (listWants); sources + sourceMaxPrice: +0 items Ponty buys to dismantle into
    //            the material while a goal wants bases; rareBases: { item: max price } - craft bases no shop
    //            sells, bought while material waits for one; extra: more goals { item, level, count }.
    // Spear (2 Bones) and Hand of the Dead (Bones) are too dear as sources: never bought for Bones, not
    // dismantled (dismantle.names). skip: never planned (Firestars need Throwing Stars, 2026-11-18).
    materialGoals: {
        enabled: true,
        auto: true,
        reserve: 0,            // material units that always stay in the bank
        maxPerGoal: null,      // null = no limit: a goal is a goal (player decision 2026-11-18)
        borrowFrom: "goals",   // "ladder" materials may borrow from the idle gear goals' pot (2026-11-18)
        skip: ["firestars"],
        materials: {
            // deliver "better" for both (player decision 2026-11-22): always the best copy we have is worn.
            // upTo 8 since 2026-11-22 (player decision): the fire weapons go to +8 before the Fiery Gloves and Ember Seals
            // get any essence (workshop.materialHold).
            essenceoffire: { upTo: 8, budget: "ladder", deliver: "better", buyCopies: false, extra: [] },
            mbones: {
                upTo: 7, budget: "goals", deliver: "better", buyCopies: true,
                sources: ["maceofthedead", "staffofthedead", "bowofthedead", "daggerofthedead"], // not the Sword of the Dead: kept, never Bones
                sourceMaxPrice: 300000,
                rareBases: { sword: 150000 }, // Short Sword, the Sword of the Dead's base (no shop sells it)
            },
        },
    },

    // Waypoints (2026-11-21): to reach the key map, walk to the value map first - main -> level1 -> spookytown
    // led the ranger through the Vampire Rats (aggro 1, 9,200 HP) twice in a row.
    // rageMargin 100 (2026-11-22): aggro checks the neighbouring 32-px grid cells - up to ~64 px from a monster at the edge.
    // rageWalls (2026-11-22): every rage box (+ rageMargin) is a wall for this frame's can_move - the path search plans
    // around them; a step starting inside may always walk out. Open stay only the zone of the walk's own goal and the
    // zones of our farm target the team can take (core/fighter.js installRageWalls). (The old after-the-fact detours
    // went round in circles and were removed.)
    // rageWallSteps (2026-11-22): margins tried one after another when the path search finds no way (-1 = walls off).
    // leaveVia (2026-11-22): leaving the key map for any other, walk to the value map first - the way back from Spooky
    // Town went through level1's Vampire Rats too (every path walk, see core/fighter.js leaveLeg).
    // wallMonsters (2026-11-22): packs without a rage box that attack on sight - their spawn boxes are walls for every path
    // walk like the rage zones (the ranger died walking through the level1 Vampire Rats on the way out of Spooky Town).
    travel: { via: { spookytown: "halloween" }, leaveVia: { spookytown: "halloween" }, rageWalls: true, rageWallSteps: [100, 50, 0, -1], rageMargin: 100, wallMonsters: ["prat"] },

    // "solo":  only the leader fights (Lone Wolf bonus); the merchant still supports it.
    // "party": all fighters form a party around the leader.
    phase: "party", // 2026-11-22 morning: party again after the warrior's solo night (VizWar 61 -> 69)

    party: {
        followDistance: 80,   // members idle within this distance of the leader
        // leash: the warrior's Agitate keeps to this around the leader; a member with the leader within it (or standing
        // at the zone) judges a rage zone with the team model, else with its own pack check (targeting zoneVerdict).
        // The follow/kite leash was removed 2026-11-21.
        leash: 300,
        // farmRadius (2026-11-22): members pick free monsters only within this of the leader (same map); the warrior
        // streamed from clump to clump ~1,000 px off in the bat cave.
        farmRadius: 400,
        broadcastMs: 2000,    // leader shares position/target this often
        inviteEveryMs: 10000, // leader re-invites a missing member this often
        // Leader waits while a fighter is farther than waitDistance px (or out of sight), at most
        // waitMaxMs per separation, and not while something attacks it (player request 2026-11-18).
        waitForTeam: true, waitDistance: 500, waitMaxMs: 45000, waitAgainMs: 60000,
        // goToDest (player decision 2026-11-21, from earthiverse): the leader tells the members where its route
        // ends; they walk there themselves and the leader waits only there, not at every door on the way.
        // toHealerBelow: a member below this HP share walks into the priest's range.
        goToDest: true, toHealerBelow: 0.5,
        // Chest opener (player decision 2026-11-20): a party chest's gold uses the opener's gold
        // multiplier, so the fighter with the highest gold bonus opens (fixed: a name to force one).
        // The others open only when it is dead, out of sight or farther than awayRange px from the
        // chest (its bonus counts only within 400 px), or after fallbackMs.
        // The leader decides and tells the members (2026-11-20: own decisions disagreed, chests piled up).
        chestOpener: { enabled: true, fixed: null, awayRange: 400, fallbackMs: 10000 },
        // Ranged fighters keep out of the monsters' melee reach (+margin) while a tank class is
        // near (player request 2026-11-18); monsters reaching farther than we shoot are ignored.
        spacing: { enabled: true, minOwnRange: 100, margin: 50, gap: 130, step: 80, everyMs: 700 },
        // Easy farm targets: members pick their own monster near the leader instead
        // of only assisting (e.g. a 500-goo hunt).
        // harmlessRatio (2026-11-19): a monster hitting for at most this share of our max HP is easy
        // whatever its HP (a tank need not kill it in maxHits).
        spread: { enabled: true, maxHits: 3, maxDamageRatio: 0.05, harmlessRatio: 0.02 },
    },

    // Damage meter (2026-11-19): every everyMs the leader (or a solo fighter) logs the real damage per
    // second over the last windowMs, per member, from the game's hit events. "/dps" prints it now.
    meter: { everyMs: 5 * 60 * 1000, windowMs: 5 * 60 * 1000 },

    tickMs: 250,

    // Routes (smart_move).
    movement: {
        useTown: true, // the Town skill (teleport to the map's center) where it shortens a route (2026-11-18)
        townMinDistance: 600, // ...but only from farther than this from the map's center (the route search counts Town as one step)
    },

    // Member watchdog (player decision 2026-11-20, main.js): every bot writes a heartbeat after each
    // loop step; the client hosting a bot window restarts it after silentMs without one (or when the
    // window is gone) - at most one restart per gapMs, maxPerHour, then it gives up with a red log.
    // A member stopped on purpose comes back too: switch this off (or stop the leader first).
    watchdog: { enabled: true, silentMs: 2 * 60 * 1000, checkEveryMs: 15 * 1000, gapMs: 10 * 60 * 1000, maxPerHour: 3 },

    // Client display only (no effect headless).
    ui: {
        hideGoldLogs: true,   // drop the game's "123 gold" loot lines from the log
        hideKillLogs: true,   // drop the game's "X killed a Bee" lines
    },

    // Events and world bosses (approved 2026-11-15). "always" or "never" (default).
    events: {
        enabled: true,
        observe: true,                  // log which events are live and what we do
        policy: {
            snowman: "always",          // holiday season world boss, 1,200 HP
            goobrawl: "always",         // daily goo fight
            phoenix: "always",          // roaming coop boss, weak hits, 180k XP, fire weapons
            // Dracul (cave, bat area; player request 2026-11-16): 240k HP, 245 magical hits,
            // 200k XP, respawns ~18 min after death at one of two cave spots. Drops firestaff
            // 5%, int/str/dex earrings 10% each, Dracul's Attire 3%, void thread 10%. Not
            // cooperative: never taken from another player who fights it.
            mvampire: "always",
            // Ms. Dracul (2026-11-22, player decision): 240k HP, 875 magical, one spawn in halloween, back after 24 min;
            // drops Dracul's Attire (1 %). Team model: the warrior tanks her (761 dmg/s vs ~1,500 healing/s, ~100 s).
            // Alone the runner holds for the team (it survives only ~4 of her hits).
            fvampire: "always",
            // Jr. (Spooky Town; player request 2026-11-17): drops the orange Lolipop Mace (+24 STR,
            // explosion splash) on every kill - a warrior weapon for the Agitate mode. 3,200 HP,
            // 80% evasion, weak magical hits, cooperative; respawns after ~5-9 h.
            jr: "always",
            // Green Jr. (Spooky Forest): the green Lolipop Mace (+24 DEX) on every kill - no loss
            // against the fireblades (no stat either), a stand-in until two orange ones are done.
            greenjr: "always",
            // Skeletor (arena, in the cgoo area; 2026-11-22, player decision "try it"): 80k HP, no armor, 1,800 physical
            // at 1.2/s, range 80, charge 56, 120k XP, back 16 min after death. The warrior takes ~1,100 a hit (~1,320/s vs
            // ~1,590 healing/s); the ranger (~1,590 a hit) and the priest (~1,600) survive only 2-3 hits - see
            // boss.minHitsNonTankBy. Drops: Tiny Ruby, armor box 5 %, weapon box 2 %, Dawnward Aegis 2 %, Shadow Stone 1 %.
            skeletor: "always",
            // Giga Crab (2026-11-23, player decision): daily, 40 min, main beach. 960k HP, 16,000 physical every 3.3 s (one hit
            // kills priest or ranger), speed 80 while it has a target, rage 0 (keeps its target). While Huge Crabs live it
            // takes 1 damage per hit ("1hp"). We kill the Huge Crabs and hit the Giga Crab only while a FOREIGN player holds
            // it and it takes damage (foreignOnly); no Taunt, Agitate, Cleave, Stomp, multi-shot or Absorb on it (noArea).
            // Goes only while the boss check passes for its Huge Crabs (joinNeeds). Fun Tokens (drop weight 1000).
            crabxx: "always",
            franky: "never", icegolem: "never",
            horseman: "never", abtesting: "never",
            graveyard: "always",          // Halloween: zombies/ghouls in Spooky Town's graveyard - Bones (2026-11-16)
        },
        // "always" only applies once every fighter has reached this level
        // Join events on a normal map (2026-11-23): their monster types, where join() puts us (counts as joined within r
        // px), what the team must handle to go, and the Giga Crab rules (see policy.crabxx).
        joinTypes: { crabxx: ["crabx", "crabxx"] },
        joinSpot: { crabxx: { map: "main", x: -1000, y: 1700, r: 600 } },
        joinNeeds: { crabxx: "crabx" },
        foreignOnly: { crabxx: "1hp" },
        noArea: ["crabxx"],
        minLevel: { phoenix: 40, goobrawl: 20, snowman: 10, graveyard: 40, mvampire: 50, fvampire: 60, jr: 40, greenjr: 40, skeletor: 60 },
        // The whole team searches only the Phoenix (player decision 2026-11-21: in one hour two team rounds
        // for Mvampire, Jr. and Green Jr. took 14.6 min - 23 % of the time - without a find). The others
        // are searched by one runner (runner below) and fought when one is met (engage).
        search: ["phoenix"],
        engage: ["mvampire", "fvampire", "jr", "greenjr", "skeletor"],
        // Parallel search (player decision 2026-11-21): the leader splits the spawn areas between the
        // fighters in the party; a find is reported and the team meets there (splitWaitMs: how long the
        // leader waits for the others' areas). holdForTeam: nobody opens the fight on an unengaged boss
        // until every fighter is within holdRange px of it - one already fighting is attacked at once.
        // holdForTeam off again the same day (player decision 2026-11-21): an unengaged Phoenix moved on
        // twice while the team gathered - whoever finds it attacks, the others join; each class has its
        // own death safeguards.
        splitSearch: true, splitWaitMs: 4 * 60 * 1000, holdForTeam: false, holdRange: 350,
        // Search again this long after a miss or a kill (player decision 2026-11-15: 30 min,
        // the walk costs farm time). Respawn times (game source): the Phoenix (respawn 32)
        // comes back ~32 s after its death at a random one of its 5 spots; Dracul (1080)
        // after 13-22 min.
        // 20 min (player decision 2026-11-21, a compromise: 30 min gave 1 Phoenix an hour; the 15-min hour
        // showed ~4 min per search with the whole team).
        searchEveryMs: 20 * 60 * 1000,
        // One runner per boss (player decision 2026-11-21): Dracul, Jr. and Green Jr. are searched by one
        // fighter alone while the others farm on. Who: the fastest ranged fighter, else the fastest melee
        // that is no tank, else a tank only while a second one stays - never the leader or a healer
        // (events.runnerCandidate; with our team the ranger).
        // bosses: search interval per boss (Jr. 7.2 h and Green Jr. 14.4 h respawn - mostly killed by
        // others already; Dracul 18 min). solo: the runner kills these alone (3-4k HP, weak hits); the
        // others (Dracul: 240k HP) are reported and held until the team is there (holdFor). maxMs: the
        // leader gives up on a runner that never reports back; killMs: longest solo fight.
        // The merchant searches bosses (2026-11-23, player decision; roles/scout.js): the bosses on scout.bosses (the
        // merchant's list) are searched by the merchant between its chores - the fighters stay at the spot and only
        // leave when it reports a find. The runner's list is runner.bosses below; for the scout bosses the runner (and
        // the team's Phoenix search) only steps in while the merchant is not available (other server, Ponty round,
        // trade trip, paused after a death, no heartbeat for freshMs) or a boss is overdue by fallbackMs. Jr. stays
        // the runner's (Spooky Town: rage zones, Vampire Rats on the way). A find (v1.220.2, player decision): the
        // merchant reports it for reportMs (every second; a step to keepAway px first when closer) and walks on; the
        // leader holds its report up to holdMs - or until one of us stood within arriveRadius px of the reported boss
        // for arriveGraceMs without seeing it (gone). Bosses on watch are watched instead: the merchant keeps keepAway
        // px and reports until a fighter is within teamNear px, it is gone (lostMs out of sight) or watchMs ran out.
        // mapOrder: the order of the maps on a round. safeWalk: every path walk of the merchant
        // plans around aggressive monsters in sight (pad px), rage zones and the travel.wallMonsters spawns (ragePad
        // px); no path: walls off for offMs.
        // Witch's Cipher (2026-11-23, player decision; events.js cipherFarm, roles/scout.js): from leadMs before a round
        // until its gathering phase ends (20 min) the team farms the ingredient the merchant reports as scarcest (bank +
        // its bag; ties at random) - the first spot of spots[ingredient] the safety checks don't block, above hunts and
        // the guide; no roaming bosses, boss searches or Daisy trips meanwhile. No report: fallback. Brewing comes later.
        // Spot lists: highest HP first where we farm safely (the drop chance grows with HP, the yield with our damage).
        witchCipher: {
            farm: true, leadMs: 10 * 60 * 1000, fallback: "embercoal",
            spots: {
                embercoal: ["gscorpion", "plantoid"],
                frostscale: ["wolfie", "boar", "arcticbee", "iceroamer"],
                gloomfeather: ["ghost", "osnake", "snake", "minimush"],
                verdantspore: ["spider", "croc", "bee", "goo"],
            },
        },
        scout: {
            enabled: true,
            bosses: ["phoenix", "mvampire", "fvampire", "skeletor", "greenjr"],
            fallbackMs: 10 * 60 * 1000, lapMaxMs: 15 * 60 * 1000, freshMs: 90 * 1000,
            reportMs: 3000, holdMs: 3 * 60 * 1000, arriveRadius: 300, arriveGraceMs: 10 * 1000, watch: [],
            keepAway: 250, teamNear: 300, watchMs: 3 * 60 * 1000, lostMs: 8000, spotMs: 3000, pauseAfterDeathMs: 30 * 60 * 1000,
            mapOrder: ["main", "arena", "cave", "halloween"],
            // hits: only aggressive monsters that kill the merchant in this many hits are walled (2026-11-23).
            safeWalk: { enabled: true, pad: 100, ragePad: 100, offMs: 60 * 1000, hits: 2 },
        },
        runner: {
            enabled: true,
            bosses: { mvampire: 20 * 60 * 1000, fvampire: 25 * 60 * 1000, jr: 60 * 60 * 1000, greenjr: 60 * 60 * 1000, skeletor: 20 * 60 * 1000 },
            // Player decision 2026-11-21 (EU IV, grown bosses): no solo kills - Jr. and Green Jr. are held for
            // the team like Dracul (holdFor). Was ["jr", "greenjr"].
            solo: [],
            maxMs: 8 * 60 * 1000,
            killMs: 3 * 60 * 1000,
            // Nonstop mode (player decision 2026-11-21): a boss on farmBosses is hunted by the runner alone,
            // lap after lap, without calling the team - only while the boss check says the runner can beat it
            // alone (else the team searches it as usual); a runner death pauses it (boss.pauseAfterDeathMs).
            nonstopKillMs: 15 * 60 * 1000, // longest solo fight
            nonstopMaxMs: 20 * 60 * 1000,  // one lap plus a fight; the leader gives up after this
        },
        // Held for the team even with holdForTeam off: Dracul stays in its area, and alone he is too strong.
        // Jr. and Green Jr. too (player decision 2026-11-21) - unless someone fights it already.
        // Empty (player decision 2026-11-22, Dracul first, then Jr. and Green Jr.): like the Phoenix the finder calls the
        // team and opens alone when the solo boss check (kiting included) says it can beat the boss - else it holds
        // outside the boss's spawn box (bossHoldRing) until the team is there.
        holdFor: [],
        // After a kill we saw, a slow boss (respawn > 200 s) is searched again only at
        // kill + respawn x respawnFactor (long respawns come up to 28 % early; 2026-11-20).
        respawnFactor: 0.72,
        // Bosses hunted nonstop: searched again after farmBossEveryMs (player option
        // 2026-11-16; Phoenix: weapons and earrings, about half the XP/h of crocs).
        farmBosses: [],                 // ["phoenix"] = nonstop Phoenix hunt by the runner alone; off again 2026-11-21 (the ranger is slower than the Phoenix charge, back to team searches)
        // 10 s (player decision 2026-11-17): with 60 s (core/events.js's default when unset) the warrior seldom
        // even reached his farm spot; now he goes straight back on the round after a kill or an empty search.
        farmBossEveryMs: 10 * 1000,
        searchSpotMs: 4000,             // look around this long at each spawn area
        // Boss check (bosses only; the guide never calls them safe): from everyone's stats
        // and the game's damage formula. Other players are not counted on.
        boss: {
            minHits: 6,                 // every fighter must survive this many hits in a row
            minHitsNonTank: 4,          // ...the others only this many while a tank (warrior/paladin) is in the team (2026-11-22)
            minHitsNonTankBy: { skeletor: 2 }, // per boss instead of minHitsNonTank (2026-11-22, player decision: Skeletor - ranger 2.1, priest 2.8 hits)
            healCover: 1.5,             // damage/s on the tank <= priests' healing/s x this (potions do the rest)
            maxFightMinutes: null,      // kill-time limit for the team alone; null = none (player decision 2026-11-15)
            priestDamageShare: 0.3,     // priests mostly heal: count this share of their damage
            // Solo (no priest): HP/s a fighter keeps up with potions and its own sustain.
            soloSustainHps: 150,
            pauseAfterDeathMs: 3 * 60 * 60 * 1000, // a death there pauses the boss this long
        },
    },

    // Monster Hunts (Daisy). Unsafe hunts are left to expire.
    hunts: {
        enabled: true, // on again 2026-11-22 with the party (player); off for the warrior's solo run 2026-11-21 evening
        minLevel: 20,                    // only once every fighter has this level (Daisy ignores our level)
        allow: [],                       // always hunt these, even if the guide calls them unsafe
        deny: [],                        // never hunt these
        // Only hunts for monsters among the team's top xpTop XP spots (player decision 2026-11-20; the
        // farm pick's ranking): a fresh account keeps hunting its beginner monsters, a stronger team
        // farms its XP spots instead of bees and snakes. 0 = every safe hunt.
        // 2026-11-22: 0 for a while (every safe hunt), back to 5 the same evening (player).
        xpTop: 5,
        // ...or the hunt monster drops something the merchant misses - a wished item or a craft ingredient, any chance
        // (dropHunts, 2026-11-23, player decision: every percent beats not farming it; Monster Tokens on top).
        dropHunts: true,
        minRemainingMs: 2 * 60 * 1000,   // skip hunts about to expire
        teamSpeedup: 2,                  // the team kills ~2x as fast as the leader alone (time check)
        visitCooldownMs: 10 * 60 * 1000, // at most one Daisy trip per 10 min
        waitAtDaisyMs: 6000,             // leader waits at least this long at Daisy...
        waitAtDaisyMaxMs: 45000,         // ...and up to this until every member is done there
        finishedRetryMs: 60 * 1000,      // a finished hunt: next Daisy trip after this at the earliest
        daisyRange: 200,                 // how close counts as standing at Daisy
        shareMs: 10000,                  // members report their hunt to the leader this often
    },

    // Items that can't be bought come before XP (approved 2026-11-15). The merchant
    // reports what is missing (wishes without enough copies + `want`), the leader's
    // guide names the best drop route and its expected time.
    drops: {
        enabled: true,
        maxHoursPerCopy: 4,         // slower drops are not farmed (guide's own time estimate)
        refreshMs: 5 * 60 * 1000,   // leader re-asks the guide this often
        reportMs: 5 * 60 * 1000,    // merchant reports shortages this often
        // Extra stock to collect even without a wish: { name, copies } (bag + bank, any level)
        // Armor Boxes for the Rugged step (2026-11-16): below 50 in stock the team farms
        // their best source - Irradiated Goo (gems -> 21 % box) - if it is safe and fast enough.
        want: [{ name: "armorbox", copies: 50 }],
        // Stage 3 (player decision 2026-11-19): with no fixed farm target the leader weighs drop
        // spots against the XP spot by power per hour (merchant's wish values); switching to
        // another spot needs valueSwitch times the value of the current choice.
        byValue: true,
        valueSwitch: 1.2,
        // Own gold per spot (player decision 2026-11-20): every fighter measures its loot gold per
        // farm target over a moving window of windowH hours (used after minMinutes); the leader
        // adds the fighters up for the drop costs that price buy orders. Only our own numbers
        // count (v1.150.0): unmeasured drop spots are 0 gold, an unmeasured normal spot gives no
        // costs at all. Counted only while all fighters farm together, within togetherRange px
        // (v1.151.0) - the party's gold is split over all of them wherever they stand.
        spotGold: { enabled: true, windowH: 3, minMinutes: 10, togetherRange: 500 },
    },

    targeting: {
        // Player decision 2026-11-17 (night): the solo warrior farms CGoos overnight (gold for the
        // budget pots after the reset, XP to 68, gems); the Phoenix is still searched every 30 min.
        // Boo Boo solo test 2026-11-17 (late) failed: he walked into the pack and died. Back to CGoos.
        // No fixed target since 2026-11-19 (player decision): the bot decides (guide XP spot or a
        // drop spot worth more). Set a monster or a list here only to test or for a drop outside
        // the wish list. (Overnight 2026-11-19 it was ["mummy", "booboo", "stoneworm"].)
        // 2026-11-21 (late evening, player): "cgoo" - the team clears the grown CGoos in the arena; back to null after.
        farm: null, // a list (2026-11-19): the first one not too strong/crowded; null = the guide picks. 2026-11-22: "bat" for the luck-catch test, back to null after
        fallback: "goo",          // used when the progression guide has no answer
        // Rare monsters attacked first when in sight (player decision 2026-11-20): golden bat
        // (24k HP, attack 50, gold), cutebee (300 HP, 99.9 avoidance), tiny pinky (5.6k HP, attack
        // 240, always a Primling), wabbit/pinkgoo/snowman (seasonal). Not tiger (attack 960) or
        // golden bot (500k HP, attack 500). Skipped while invulnerable (snowman fullguard).
        rare: { enabled: true, range: 400, types: ["goldenbat", "cutebee", "tinyp", "wabbit", "pinkgoo", "snowman"] },
        // Farm only where every fighter's own guide calls the spot safe; routes the guide
        // only offers as a careful trial count once proven - by the guide's own fights, or
        // by 15 min of team farming there without a death (remembered across restarts).
        avoidTrial: true,
        // Melee classes never hit monsters returning this much damage (dreturn in %, porcupine
        // 4800 = 48x back - one hit kills a warrior; armadillo 30 is fine). Ranged ones farm them.
        // Lowered to 20 (2026-11-16): armadillos (30 %) nearly killed the solo warrior - his
        // dual-wield hits and Cleave on several of them came back faster than potions heal.
        melee: { classes: ["warrior", "paladin", "rogue"], maxDreturn: 20 },
        // The current farm spot is left only when a member's "unsafe" lasts this long
        // (verdicts near the edge flip back and forth); a death there counts at once.
        objectionGraceMs: 5 * 60 * 1000,
        // Team model (on since 2026-11-16, a test with the warrior as tank): a spot
        // counts as safe when the party can take it together - the tank survives tankHits
        // volleys of `pull` monsters (pullAggressive for monsters that attack on sight),
        // the priests' healing covers that damage x healCover, everyone else survives
        // otherHits hits until the tank's Taunt pulls the monster. Spots are then ranked by
        // the guide's XP. Off: every member's own guide must call the spot safe alone.
        // "/safety [map]" in the leader's client logs both verdicts per monster.
        teamSafety: {
            enabled: true,
            tankClasses: ["warrior", "paladin"],
            tankHits: 6, otherHits: 3, healCover: 1.5,
            pull: 2, pullAggressive: 3,
            pullPassive: 1,                // aggro and rage below isolation.minAggro/minRage: one at a time (2026-11-21)
            pullLone: 2,                   // monsters pulled one at a time (isolation): one plus a possible add
            // Aggressive monsters whose spawn area per monster is below this (px²) come as a
            // whole pack (vampire rats: 5 in 150x195 wiped the team, 2026-11-16).
            denseArea: 15000,
            abilities: [],                 // monster abilities we accept (others: the guide decides)
            // The whole fight: damage/s the priest's heals and the tank's potions don't cover,
            // for as long as the team needs to kill it, must stay below this share of the
            // tank's max HP (level-12 White Wolves have 312k HP, 2026-11-17).
            fightHpUse: 0.5,
        },
        // Monsters that join a fight (aggro: they hit whoever passes close by; rage: they then
        // stay on that player and chase him - game source) are only pulled when no other free
        // such monster stands within radius of the target, of where we will stand or of the
        // way there. Walking into the middle of the White Wolf pack (rage 1) wiped the team
        // (2026-11-17); one at a time they are fine. Without rage a monster only lands a hit
        // in passing (bees 0.1, crabs, scorpions), and harmless ones never count.
        // strongHold: too-strong ones of the farm type stop the search walk only this close.
        // watchMargin (2026-11-19): waiting for a lone one, the leader stands this far outside the spawn box edge
        isolation: { enabled: true, minAggro: 0.3, minRage: 0.3, radius: 120, strongHold: 300, watchMargin: 150 },
        // Spot check (2026-11-22, after the warrior walked into the grown booboo pack): the one who picks the spot
        // (solo, leader) stops at its edge - spawn/rage box + the monster's range + 50 px (margin..maxMargin) -,
        // looks for watchMs and judges what is there (aggressive kinds as one pack, passive ones by the live check).
        // Too strong: blocked like a too-strong spot, another target. party: false = solo only.
        // maxMargin 150 (2026-11-22): monsters only join on contact or in their rage box - their shooting range doesn't
        // matter. From 450 px the 4-booboo spawn was out of sight, "level 1 assumed" passed level-17 booboos.
        // groupGap (2026-11-22): passive kinds standing close (free ones chained within groupGap px, edge to edge) are
        // judged as one pull too - the X-scorpions passed one by one, the splash pulled 6 and the warrior died.
        spotCheck: { enabled: true, party: true, margin: 150, maxMargin: 150, watchMs: 3000, maxWaitMs: 30000, groupGap: 60 },
        // Learned hit factor (2026-11-22, iceroamers hit 2.3x what the formula says): every hit we take is compared
        // with attack x damage multiplier; from minHits hits of a kind on, the safety checks multiply its hits by
        // real / predicted (1 .. max). Sums are halved above keepHits (old hits fade). "/safety" lists the factors.
        hitFactor: { enabled: true, minHits: 8, max: 5, keepHits: 400 },
        // Mobbing (2026-11-22, server rule, verified with goos): more than 3 monsters targeting one player multiply every hit
        // on that player - combo 2..10: 1.62..2, then combo / 4, at most max(300 / attack, 1.2); the combo counts landed
        // hits and resets after 5 s without one. All pack checks (solo, Agitate, team model, spot check) include it.
        //   guard: no new free monster while maxOnOne are on one of our fighters (unless mobbing adds at most guardMinMult)
        //   projectSec: the live check carries the combo this far ahead (warrior escape / Agitate stop)
        mobbing: { enabled: true, guard: true, maxOnOne: 3, guardMinMult: 1.25, projectSec: 4, healShare: 0.8 }, // healShare: share of a healer's heal/s counted in the live check
        // Rage zones (2026-11-22, server rule): a spawn with a "rage" box in the map data (spookytown: mummies, both
        // booboo spawns) sends every member at a player standing in the box, every 4.2 s. Such a spawn counts as a
        // whole (pack check / team model); failing it, we pick none of it whose spot or way lies in the box, step out
        // when standing in it, and call the Cavalry from its edge.
        rage: { enabled: true },
        // Monster levels (player request 2026-11-16): from this level a monster is checked
        // again with its real stats before we pull it - the team model when it is on, else
        // ownHits (party member) or soloHpUse (solo). Only while the team stats are not in yet
        // its damage per second must stay within waitTolerance x the level-1 monster's.
        live: {
            fromLevel: 2,
            ownHits: 6,           // members/solo picking their own target: survive this many real hits
            // Solo: the HP lost over the whole fight (real damage/s minus own healing: a potion
            // per cooldown, priest self-heals, lifesteal, for the time we need to kill it) must
            // stay below this share of max HP. 0.7 (player decision 2026-11-17): such a fight
            // only starts with enough HP to end it at 30% or more (fighter: heal up first).
            soloHpUse: 0.7,
            waitTolerance: 2.5,   // only while the team stats are not in yet: real/level-1 damage ratio cap (level-5 CGoo: 1.9x)
        },
        refreshMs: 5 * 60 * 1000, // how often to ask the guide again
        crowdedAfterMs: 90 * 1000,    // no free target this long on the farm map -> spot is crowded
        // ...or this share of a window without a free target (other players leave us only
        // the odd monster, e.g. one per minute):
        crowdedWindowMs: 3 * 60 * 1000, crowdedIdleShare: 0.7, // idle = not in range of a target (walking counts)
        crowdedForMs: 60 * 60 * 1000,  // then use the guide's next choice for this long,
        // Another player within occupiedRadius of the farm spot we walk to: that spot is skipped
        // for occupiedForMs and its free monsters are left alone (2026-11-18, Eagle at the bats).
        // occupiedForMs 20 -> 60 min (player decision 2026-11-19).
        // A taken spot we stand on without another player's fighter for occupiedFreeMs is free
        // again (player decision 2026-11-20).
        occupiedBy: 1, occupiedRadius: 300, occupiedAfterMs: 20000, occupiedForMs: 60 * 60 * 1000, occupiedFreeMs: 30 * 1000,
        // Shared, not taken (player decision 2026-11-21): another player on the spot is fine while we had a
        // target at least stayIfBusy of the last shareWindowMs on it (judged after shareMinMs on the spot).
        // 0.9 -> 0.75 (player decision 2026-11-21, evening): the melee warrior fought nonstop at the CGoos
        // next to another player's three bots and still left the spot as taken. Walking stays idle.
        stayIfBusy: 0.75, shareWindowMs: 2 * 60 * 1000, shareMinMs: 60 * 1000,
        crowdedMaxMs: 6 * 60 * 60 * 1000, // doubled each time the same spot is crowded again within a day
    },

    // Cavalry (Tracktrix): emergency rescue and resetting grown farm spots (2026-11-18).
    // Strong only while the account's highest level is below 80.
    // targets (2026-11-19): spots nuked whenever the Cavalry is ready and the first farm target is
    // fine (loot at high level, e.g. dinos for bones); with the first farm target too strong the
    // Cavalry resets that one instead. Then back to the farm list.
    cavalry: { enabled: true, emergencyHpBelow: 0.35, emergencyOnMe: 1, reset: true, resetFromLevel: 5, resetMinCount: 2,
        targets: [], planStayMs: 100 * 1000, planMaxMs: 10 * 60 * 1000,
        foreignClear: 420, planMinCount: 5, resetPackMin: 5 }, // resetPackMin (2026-11-21): a reset waits for this many grown ones in reach (or all in sight), walking towards them // planMinCount: a plan call waits for this many of the kind in reach (or all in sight) // no reset/nuke call with another kind of level-3+ monster this close (the fairy, 2026-11-19)

    combat: {
        // Kiting (fighter.kiteStep, after earthiverse's KiteMoveStrategy, player decision 2026-11-21): a
        // fighter that outranges an attacker on it (by margin px) and is about as fast (its charge speed
        // up to maxSpeedRatio x ours) stands on a circle around it - radius: its charge speed + its range +
        // extra px, at most our range - rangeSlack - keeping the angle it stands at, and only moves while
        // inside that circle (less slack px). Re-planned every everyMs; points near free monsters
        // (avoidRadius) are avoided. The warrior never qualifies (range 38).
        // maxSpeedRatio 0.99 (2026-11-21): only monsters slower than us - a Phoenix charging at 65 vs our 64 can't be
        // outrun, the ranger only dragged it through the cave. anchorRadius: boss kiting stays this close to
        // the middle of the boss's spawn area.
        // farmRisk/farmSpeedRatio/farmRangeMargin (player decision 2026-11-21): in the farm checks a kiteable monster
        // (util.kiteRisk) hits with farmRisk of its damage - a residual risk, never 0.
        kite: { enabled: true, margin: 30, extra: 50, rangeSlack: 10, slack: 15, maxSpeedRatio: 0.99, anchorRadius: 280, everyMs: 250, avoidRadius: 120,
            // foreignMargin (2026-11-22): kite, escape and spacing points stay this far beyond the reach of monsters of
            // other kinds than the farm target (Fire Spirits, range 280, next to the Giant Scorpions).
            foreignMargin: 50,
            farmRisk: 0.25, farmSpeedRatio: 0.9, farmRangeMargin: 50 },
        potionHpBelow: 0.8,      // below this: an HP potion on every cooldown (player decision 2026-11-16, was 0.45)
        // 0.5 since 2026-11-21 (player decision): below it MP comes before the HP top-up (HP above half).
        // At 0.3 the solo warrior's own attacks (11 MP each, ~10 MP/s) drained him while every potion
        // went to HP (< 80 % all fight long at the CGoos) - he rested after almost every fight.
        potionMpBelow: 0.5,
        // MP before the HP top-up (below potionMpBelow, or once a whole MP potion fits) only above this
        // HP - between the rest line (recover.hpBelow 0.5) and potionHpBelow (player decision 2026-11-21).
        mpFirstAboveHp: 0.65,
        // Test 2026-11-21 (player): an HP potion whenever a whole one fits, MP only in the gaps (mpFirstAboveHp
        // is then ignored). Solo only - with a healer near potionWhenMissing is off. false = the rules above.
        hpWhenFits: true,
        // Otherwise drink as soon as a whole potion's worth is missing (HP before MP), i.e.
        // on every cooldown in a long fight (player request 2026-11-16).
        potionWhenMissing: true,
        // With a priest in the party close by (or as the priest): potions only as an
        // emergency, the healing does the rest (player decision 2026-11-16).
        // fastLossPerSec (2026-11-18): losing this share of max HP per second (over ~3 s) - the solo
        // potion rules apply although a healer is near (Jr. killed the warrior next to the priest).
        // Pass through (2026-11-19): the leader/solo on its way to the farm spot leaves slower
        // attackers of other kinds behind instead of fighting them (above minHp, not within
        // spotRadius of the spot).
        // leaveAfterMs (2026-11-19): after this long fighting another kind than the farm target, every
        // fighter walks out towards the target whatever the speed or HP (slow ones are left behind).
        passThrough: { enabled: true, minHp: 0.5, speedShare: 0.8, spotRadius: 400, leaveAfterMs: 60 * 1000 },
        withHealer: { potionHpBelow: 0.6, potionWhenMissing: false, fastLossPerSec: 0.06 },
        // MP: drink as soon as this share of an MP potion is missing - solo and in the party
        // (player decision 2026-11-17: "Mana kann ruhig immer voll sein", potions are cheap).
        mpTopUp: 0.5,
        // Below this HP an HP potion always comes first; above it MP comes first once MP is
        // below potionMpBelow and HP above half, or nearly empty (at 0 MP the solo warrior
        // could not attack and only took hits, 2026-11-17).
        hpCriticalBelow: 0.3,
        // Without a priest close by (solo): after a fight below hpBelow HP or mpBelow MP the
        // fighter pulls nothing new and drinks back up to hpUntil / mpUntil first (player
        // request 2026-11-17: 2-3 higher-level CGoos in a row wore the warrior down).
        recover: { enabled: true, hpBelow: 0.5, mpBelow: 0.5, hpUntil: 0.8, mpUntil: 0.8, maxMs: 90 * 1000 },
    },

    classes: {
        paladin: {
            selfHealBelow: 0.6,
            useSmash: true, mpReserve: 150, // Smash needs a mace
            oathBelow: 0.5,                 // Guardian's Oath on allies below 50% HP (lvl 50+)
            useCleansingLight: true,        // lift poison/curse/burn/... from allies (lvl 30+)
            // Mana Shield: damage drains MP instead of HP while on
            manaShield: { onBelow: 0.35, offAbove: 0.7, minMp: 0.25 },
        },
        priest: {
            healBelow: 0.75, selfHealBelow: 0.6,
            partyHealBelow: 0.65,           // Party Heal when 2+ members are below this...
            partyHealDanger: 0.35,          // ...or one member is below this
            partyHealOne: 0.5,              // ...or any member (also out of sight, from its heartbeat) is below this (earthiverse, 2026-11-21)
            useCurse: true, mpReserveRatio: 0.4,
            useRevive: true,                // revive fallen members (consumes an Essence of Life)
            // Absorb Sins (lvl 55): emergency only - a member below `below` with monsters on it
            // and no warrior/paladin within Taunt range of it; only while we are above selfAbove.
            absorb: { enabled: true, below: 0.35, selfAbove: 0.6 },
            // Luck catch (2026-11-22, player decision; test): drops roll with the luck of the monster's target at death.
            // A monster on an ally that dies within `hits` hits of our strongest fighter: Absorb Sins pulls everything off
            // that ally (at most maxPull, priest above minHp, once per everyMs per ally). A tank (Taunt/Agitate) within
            // tankRange takes the longer-living ones back and spares the dying ones; without a tank only what the
            // priest's courage holds per damage type. Bosses included. Logged every logEveryMs.
            luckCatch: { enabled: true, hits: 2, maxPull: 5, minHp: 0.6, everyMs: 1500, tankRange: 400, logEveryMs: 10 * 60 * 1000 },
            // Luck swap (2026-11-22, player decision, gear plan v2): the INT gear in normal fights; right before Absorb Sins
            // (luck catch) the priest puts these on with one equip_batch call - Shield M, Rabbit's Foot, the five Wanderer's
            // pieces (set bonus +16 luck) and a Clover Stud - and changes back backMs after the last catch (core/gear.js).
            // Pieces it does not have yet are skipped; the best copy of each stays in its bag.
            // Two Clover Studs (2026-11-23, player decision): one for each earring slot - a piece listed twice fills both slots.
            luckSwap: { enabled: true, items: ["mshield", "rabbitsfoot", "wcap", "wattire", "wbreeches", "wgloves", "wshoes", "cloverstud", "cloverstud"], backMs: 3000 },
            // Dark Blessing (lvl 70): +25% party damage for 8 s on targets needing sturdyHits+
            // of our hits, and on bosses.
            darkBlessing: { enabled: true, sturdyHits: 10 },
        },
        // Rogue (module added 2026-11-18): Quick Stab/Punch follow the mainhand (dagger/fist).
        rogue: {
            mpReserveRatio: 0.25,
            swiftness: true,          // Rogue Swiftness (lvl 40) on us and party members in reach
            smokeBelow: 0.25,         // Assassin's Smoke below this HP share with monsters on us (0 = never) ...
            smokeUntil: 0.6, smokeClear: 200, // ... then hide where no monster is within smokeClear px until this HP share
            mentalBurst: true,        // only once INT reaches the skill's 64
            fanFrom: 3,               // Fan of Knives (lvl 65, Knife Belt) with this many monsters around
            poisonCoat: { enabled: true, minHits: 40 }, // A Poisonous Touch (Poison Sack) on targets needing 40+ hits
        },
        ranger: {
            sturdyHits: 3,                  // Hunter's Mark / Supershot only on targets needing 3+ hits
            mpReserveRatio: 0.3,
            usePoisonArrow: true,           // consumes a Poison Sack
        },
        warrior: {
            mpReserveRatio: 0.2,
            // Taunt a monster off an ally that is below allyHpBelow, or that hits for at
            // least hitRatio of the ally's max HP per hit ("harder targets").
            // Also always (2026-11-20): bosses (cooperative, events.search, or max HP >= bossHp) and
            // anything on our healer - a kiting priest walked the Phoenix around the map.
            // walkFirst (2026-11-20): walk up to the monster (within range + closeBy), then taunt - from
            // afar only when the ally is below urgentHpBelow or the monster returns damage to melee.
            // first/agitateOver (2026-11-22, luck-catch test): true = Taunt takes monsters off allies one by one first, Agitate only
            // from agitateOver on allies. Tested at the bats: priest share 82 -> 91 % but ~10 % fewer kills, so off (player:
            // more kills = more XP).
            taunt: { enabled: true, first: false, agitateOver: 6, allyHpBelow: 0.8, hitRatio: 0.05, bosses: true, bossHp: 20000, offHealer: true,
                walkFirst: true, closeBy: 25, urgentHpBelow: 0.5 },
            agitateFrom: 3,                 // Agitate (lvl 68) when this many monsters are on allies
            cleaveFrom: 3,                  // Cleave (lvl 52, axe/scythe) with this many monsters around
            stompFrom: 2,                   // Stomp (lvl 52, basher) with this many attackers
            sturdyHits: 4,                  // War Cry (lvl 70) on targets needing this many hits
            hardShell: { enabled: true, factor: 3 }, // lvl 60: when the predicted next physical hits x factor reach our HP (2026-11-21)
            useCharge: true,                           // +30 speed whenever we walk (on cooldown)
            // Dash: the server accepts a point at most 50 px away (game source) - a 120 MP hop,
            // no gap closer. Off since 2026-11-16 (the old 150 px jumps always failed).
            // Combat dash only (player decision 2026-11-21): towards our target or the hit member, from
            // "from" px, up to "max" px, above minMpRatio MP, one per everyMs; a failure pauses it pauseMs.
            // Off again 2026-11-21 evening (player, for now).
            dash: { enabled: false, from: 80, max: 49, minMpRatio: 0.5, everyMs: 1000, pauseMs: 10000 },
            // Sword swap (player decision 2026-11-21): once fire blades are worn, the best `count` Swords of the
            // Dead stay in the bag and go on for targets that fall in maxHits hits (burn needs ~5 s and never
            // procs on the killing hit); longer fights, bosses and events bring the fire blades back. holdMs:
            // how long the swords stay on after the last quick target.
            swordSwap: { enabled: true, names: ["swordofthedead"], count: 2, maxHits: 5, holdMs: 60 * 1000 },
            // Agitate pack mode (solo, lvl 68; test since 2026-11-18): with minPack free monsters
            // within Agitate range he puts on his splash weapons (explosion, e.g. Lolipop Maces),
            // casts War Cry + Agitate, steps kiteStep px away so the pack follows from one side,
            // then always hits the monster with the most others in the splash radius. Spread out
            // (fewer than regroupBelow splash neighbours per hit over the last hits): another step.
            // Each pull is logged ("pull done: ... splash neighbours per hit").
            agitate: {
                enabled: true,
                // "auto" (2026-11-18): the bot decides per farm target (safety, learned splash -
                // see the warrior module); a list forces these kinds; deny excludes kinds.
                monsters: "auto", deny: [],
                maxOnMe: 8, maxHp: 50000, abilities: [], // auto: at most this many at once; no bosses / unknown abilities
                splashOnlyFrom: 3, splashOnlyHoldMs: 8000, // Lolipops without Agitate with this many on us (splash must pay) - 2026-11-19
                // ...and only when we survive what the splash pulls (2026-11-22, X-scorpions: 3 on us became 6): those on
                // us plus the free ones chained within the splash radius + splashPullSlack px, by the team model (party)
                // or the pack check's safe count (solo).
                splashPullSlack: 40,
                // offAfterMs (2026-11-22): a running auto mode goes off on a live "no" (pack check, level cap) only after it
                // held this long - it flipped swords <-> off every 15 s at the CGoos; each Agitate checks what is in reach anyway.
                offAfterMs: 60 * 1000,
                fearMax: 0, // attackers of one damage type beyond our courage for it (each one more costs 20-40 % attack)
                maxLevel: null, safetyShare: 0.5, // auto: no fixed level cap (the pack check uses real stats; a number caps by hand); a pull may cost only half the HP the pack check allows
                splashMin: 1.0, learnHits: 40, denseCount: 5, denseSpacing: 130, // auto: lolipops from 1.0 splash per hit (guess from spawn density first)
                deathDenyMs: 2 * 60 * 60 * 1000, // auto: no Agitate on a kind for this long after dying to it
                // Escape from a losing fight (slower monsters only; in a party see partyEscape): solo it starts below escapeHp, lasts while anyone is on
                // us and can reach us (its range + escapeMargin, at least escapeClear) or we are below escapeUntilHp; at most escapeMaxMs.
                // escapeLossSec (2026-11-22): the escape also starts when the HP really lost over this many seconds (burn, every
                // hit, heals and potions included) would kill us within escapeTtdSec, or when a monster on us is rejected by the
                // team model / pack check even alone (a Fire Spirit's stacking burn killed the warrior with "1 on me").
                // escapeKeepOff (2026-11-22): escape points keep free dangerous monsters' range + this (at least 150 px) and
                // other aggressive spawns' boxes + this clear - twice the warrior ran into the Fire Spirits by the Giant Scorpions.
                escapeHp: 0.3, escapeUntilHp: 0.6, escapeMaxMs: 45000, escapeClear: 250, escapeMargin: 100, escapeStep: 200, escapeKeepOff: 80, escapeLossSec: 3,
                // Mobbing (more than 3 on us): escape already below escapeMobHp when the live combo kills us within
                // escapeTtdSec; no new Agitate while it would within mobStopTtdSec (2026-11-22).
                escapeMobHp: 0.7, escapeTtdSec: 8, mobStopTtdSec: 20,
                // Party escape (2026-11-22): the warrior runs too when the live check - the priest's healing included - says he
                // dies within escapeTtdSec (mob, or below escapeHp); steps stay within the healer's reach where possible.
                partyEscape: true,
                // Gap step (player idea 2026-11-22, solo and party): splash weapons on, minOnMe+ on us and the best target's
                // splash misses one in range -> a step of "step" px into the largest angle gap between them, so they follow and
                // bunch up on one side. At most every everyMs; from minMs when all of them are in range again.
                gapStep: { enabled: true, step: 50, everyMs: 4000, minMs: 2500, minOnMe: 3 },
                weapons: "splash",    // "splash": put on the splash weapons; "keep": pull with the usual ones ("/agitate off|swords|splash|chain|splashstream|config" switches the mode at runtime)
                minPack: 3,
                minHp: 0.8,           // start a pull only above this HP share
                abortHp: 0.3,         // below: walk away from the pack
                gather: "center",     // "center": walk into the pack, Agitate there, all arrive together; "step": Agitate, then step away
                centerWithin: 20,     // "center": at the pull point within this distance
                searchRadius: 200, gridStep: 40, // "center": pull points tried around us
                // Clear of other kinds (2026-11-23, player decision): before every Agitate (stream, pull point, protective) no
                // monster of another kind (live, any target but us) within reach + clearMargin px (centre distance; the server
                // measures hitbox to hitbox). With one there: walk to the point within clearSearch px that is clear of all of
                // them and keeps the most of ours in reach (on allies first); none: no Agitate.
                clearMargin: 80, clearSearch: 240,
                // Toward the spot middle (2026-11-23, player decision, part 1): more than homeSlack px from the middle of the
                // farm kind's spawn box (within homeNear px of it), the warrior first walks up to homeStep px to a point at
                // least homeMinGain px nearer the middle (monsters on allies stay in reach, clear of other kinds), then
                // Agitates there - the priest pulls the pack outward, the warrior pulls it back. homePxPerMonster: that
                // much nearer the middle is worth one free monster more in the point choice. home: false switches it off.
                home: true, homeSlack: 100, homeStep: 160, homeMinGain: 40, homeNear: 600, homePxPerMonster: 40,
                avgPerMonster: 60,    // "center": one monster more in reach is worth this much less average way (px)
                sideStep: 50,         // "center": step out of the pack after Agitate (0 = stay)
                adjustStep: 40, adjustEveryMs: 4000, // "center": step when monsters come from behind
                waitShare: 0.7, waitMs: 3000, // first swing once this share of the pulled pack is in range (at most waitMs)
                chaseFrom: 3,         // with this many or fewer left and none in range: walk to the nearest one
                swords: "stream",     // mode "swords": "stream" = Agitate on every cooldown where we stand (normal combat), "pull" = the pull-point version
                streamFrom: 1, streamOnMe: 3, // "stream": Agitate when this many free ones are in reach and fewer than streamOnMe attack us (auto: splashOnMe, so the splash is measured fairly)
                splashOnMe: 5, sugarBonus: 2, agitateEverySec: 6, // "splashstream": up to 5 on us (raise once the bat deaths are understood; mana: one Agitate per 6 s) ...
                streamLowHp: 0.6, streamStopHp: 0.4, // ... at most 2 below 60% HP, no Agitate below 40%
                streamToClump: true, clumpRadius: 60, clumpStep: 80, // "splashstream": walk to clumps (each neighbour within 60 px is worth 80 px of way)
                // In a party (2026-11-18): only a stream mode, on the leash - no pull points; partyMode "auto"
                // walks to clumps like solo. The protective Taunt/Agitate for allies goes first. The same limits
                // on how many may be on us as solo (no party boost).
                partyMode: "auto", // "auto": the automatic decision for the leader's farm target - same stream as solo (walks to clumps, same limits; 2026-11-18)
                kiteStep: 120,        // "step" (and backing off): this far
                gatherMs: 2500,
                regroupBelow: 0.5, regroupEveryMs: 8000,
                keepMs: 60 * 1000,    // splash weapons stay on this long after a pull
            },
        },
        mage: {
            energizeAbove: 0.6,             // only give mana while we have more than this
            energizeBelow: 0.4,             // to a member below this MP ratio
            useBurst: false,                // Mana Burst empties the whole MP pool
        },
    },

    potions: {
        hp: "auto",       // "auto": small potions until the pool is big enough, then big ones
        mp: "auto",
        bigFrom: { hp: 1500, mp: 1000 }, // max HP / max MP from which hpot1 / mpot1 are used
        target: 300,       // fighters get topped up to this many of each
        requestBelow: 100, // ask the merchant for more below this
        selfBuyBelow: 20,  // walk to town and buy yourself below this (merchant missing)
    },

    // Fighter side of the item/gold flow
    supply: {
        keep: ["tracker"],               // never handed to the merchant
        keepByClass: { priest: ["essenceoflife"], ranger: ["poison"] }, // skill ingredients
        // Fighters only need gold to buy potions themselves when the merchant can't;
        // the merchant buys all equipment. So they keep a small emergency fund
        // (100 big potions) and hand everything else over (player decision 2026-11-15).
        goldKeep: 10000,
        goldMinSend: 5000,               // only send gold when the surplus is at least this
        freeSlotsMin: 6,                 // ask for a pickup when fewer slots are free
        pickupEveryMs: 20 * 60 * 1000,   // ask for a routine pickup this often (20 min since 2026-11-22, player decision; was 15)
        firstPickupAfterMs: 60 * 1000,   // first routine pickup this long after the bot starts
        requestEveryMs: 60 * 1000,       // don't spam the merchant
        merchantTimeoutMs: 3 * 60 * 1000, // no answer for this long -> buy potions yourself
        // While the merchant is on its way we keep farming and send our position this often,
        // for at most followMs after the request (player decision 2026-11-17).
        positionEveryMs: 5000,
        followMs: 5 * 60 * 1000,
    },

    // Fighters: equipment wishes from the progression guide + auto-equip
    gear: {
        enabled: true,
        // Never equipped automatically, taken off when worn (player decision 2026-11-18):
        // Hand of Midas (-20 speed), Heavy Underarmor, Dracul's Attire (mcape, a chest piece).
        // Dracul's Attire and Heavy Underarmor off the list 2026-11-22 (gear plan v2): they are steps of the plan now,
        // guarded by minLevel below.
        noEquip: ["handofmidas"],
        // Never put on below this level (2026-11-22, player decision): Dracul's Attire replaces the warrior's Rugged
        // coat only from +7 (no stat drop below +7); Heavy Underarmor the same.
        minLevel: { mcape: 7, hpants: 7 },
        // At most this many worn at once (2026-11-22, player decision): one Zapper - its zap skill exists only once.
        maxWorn: { zapper: 1 },
        wishEveryMs: 5 * 60 * 1000, // re-read the guide and resend wishes this often
        maxWishes: 12,  // class chains alone are up to 9 (ring, earring, belt, orb, cape, five Rugged pieces)   // a longer list shifts less (the merchant works through it one by one)
        // Class wishes for slots the guide leaves empty: the chains of gearPlan.wishes (below), built
        // per class by gearPlan.chainsFor (core/gear.js classChains). An entry
        // is one item or a chain { steps: [...] }: only the first step the worn piece does
        // not reach is wished, a piece of a later step (e.g. a lucky drop) counts for the
        // earlier ones and is equipped over them. A slot holding something outside the
        // entry is left alone. Not counted as gear goals (no further upgrades).
        // Active again since 2026-11-16 (player decision). Rugged armor (armor boxes) comes
        // after the shop armor: wished only once ALL shop gear is done (armor at the last
        // gearGoals stage, weapons at gearGoals.upTo - both +8 now), kept by the merchant until
        // +7 and then worn over the shop piece (replace).
        // Helmet, gloves, pants first: most common in boxes, and 3 pieces give +20/+20.
        // Tanks only (player decision 2026-11-16): Rugged +7 has 10 main stat, shop +8 has 12,
        // so the priest and ranger keep their shop +8 (damage/healing); the warrior trades
        // 2 STR per piece for ~3x the armor and resistance.
        // The Monster Hunter sets are long-term and stay out for now.
        classWishesEnabled: true,
        // Belts (player decision 2026-11-19, replaces the tank HP-belt chain of 2026-11-17):
        // every class takes its main-stat belt (+4 at +0, +10 at +2) over an HP belt and
        // compounds it to +2. An HP belt is only worn while no stat belt is there (the guide
        // fills the empty slot). Stat belts drop in Spooky Town (map drop).
        // Gear plan phase 1 (player decision 2026-11-19; the plan is gearPlan below, the community chart
        // it comes from is docs/gear-guide/gear-guide-data.json): rings, earrings, amulets and belts go on to +4.
        // Item stages: a wish for the next level waits while a lower wish for the same item is
        // still missing (workshop openWishes) - other items never block it.
        // Rings, earrings and amulets: main-stat pieces +2, then +3, then +4 for both slots of each
        // (+3 needs ~91 copies at +0 per piece - Phoenix earrings, Winterland rings).
        // Rings (player decision 2026-11-16): two stat rings +2 in the class's main stat
        // (+6) replace the Rings of Small Joys +2 (+3 STR/INT/DEX, +15 resistance) - at +0/+1
        // they are no better. Delivered only complete, worn over a Ring of Joy right away
        // (anytime: no wait for the shop gear). Copies: Winterland map drop (statring table).
        // The wish chains themselves live in gearPlan.wishes (below) since 2026-11-19.
    },

    // =================================================================
    // Gear plan (player decisions 2026-11-19): the ONE place for our gear progression.
    // The fighters' class wishes are built from `wishes` (chainsFor, called by core/gear.js) and
    // `equivalent`; scripts/gear-plan-guide.mjs renders the whole block as the PDF guide
    // (docs/gear-guide/gear-plan.pdf). Derived from the community chart
    // (docs/gear-guide/source-chart.webp) and our own decisions.
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
            "Wanderer's set: each piece has the stats of the shop piece of its slot plus a little (cap +120 HP, attire +80 MP, breeches +1 speed) and the set bonus (2: +200 HP, 3: +100 MP, 4: +10% gold, 5: +16 luck). A dropped piece is built to the worn shop piece's level and replaces it, then runs with the armor goals in parallel - a horizontal upgrade, never crafted, never ahead of real upgrades. Not for tanks on the Rugged set. Exception: the chest opener (priest) wishes its pieces actively (2026-11-20).",
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
        },
        groups: {
            physical: ["warrior", "ranger", "rogue", "paladin"],
            caster: ["mage", "priest"],
            tank: ["warrior", "paladin"],
            nontank: ["ranger", "priest", "rogue", "mage"],
        },
        // Class wish chains for one class ({ name, level } or { steps: [...], replace, anytime, ... }); used by core/gear.js classChains.
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
        // Weapon lists per class (player decision 2026-11-21): items only, worst to best. The merchant goes from
        // the BACK: the last item we hold a copy of (any level) is upgraded, step by step, as long as a step
        // beats the fighter's weaker worn weapon (util.weaponPower: burn counts, but not for the priest) -
        // each better copy is delivered. Nothing to work on (no copy, no budget, below the worn one even at its
        // cap): one item further to the front. The shop weapon at the front is the gear goals' job. Fire weapons
        // are made from essence (materialGoals): their priority is their place from the back (1 = last item),
        // lower numbers first. Ponty buys bases for every item that would beat the worn weapon.
        weapons: {
            warrior: ["blade", "swordofthedead", "fireblade"],
            priest: ["staff", "firestaff", "staffofthedead"],
            ranger: ["bow", "hbow", "firebow", "crossbow"], // gear plan v2: Hunting Bow and Crossbow
            rogue: ["stinger", "daggerofthedead"],
        },
        // Highest level the list items are upgraded to (per item, else default).
        weaponCaps: { default: 7, fireblade: 8, firestaff: 8, firebow: 8 }, // fire weapons +8 since 2026-11-22 (player decision)
        // Bones and essence: see materialGoals (2026-11-22).
        // Shop armor per slot: gear goals push the worn piece through workshop.gearGoals.stages
        // (up to gearGoals.upTo) with the main-stat scroll - no wish needed.
        shop: { helmet: "helmet", chest: "coat", pants: "pants", shoes: "shoes", gloves: "gloves" },
        // A piece that replaces the worn shop piece of its slot at the same level or higher.
        equivalent: { wcap: "helmet", wattire: "coat", wbreeches: "pants", wshoes: "shoes", wgloves: "gloves" },
        // Equivalents run with the armor goals for this group (2026-11-19): a dropped piece is built
        // to the worn shop piece's level and replaces it, then goes up instead of it; without a spare
        // copy the shop piece goes higher and takes the slot back. Copies nobody can use any more
        // (all at the last stage) are sold.
        parallel: "nontank",
        // ...and crafted, but only when every ingredient is in stock (player decision 2026-11-19 -
        // never a reason to farm; standing buy orders in market.buy keep the materials coming).
        craftFromStock: ["wcap", "wattire", "wbreeches", "wgloves", "wshoes"],
        // Wish chains, in wish order. `item` + `to` (and `from`: one step per level from..to) or
        // `steps`: [[item, level], ...]. replace: worn over pieces outside the chain; anytime: not
        // only after the shop gear is done; alts: worn alternatives pause the chain; carry: kept
        // in the bag for a mode (count copies, insteadOf: stand-in for another carried item).
        wishes: [
            { slot: "cape", item: "cape", to: 0, single: true, how: "exchange: 40 Leather" },
            // Tanks take the Winged Boots after their Rugged Shoes +8 (tank shoes chain below).
            { slot: "shoes", item: "wingedboots", to: 7, replace: true, for: "nontank", how: "craft: Shoes + 20 Magical Feathers" },
            // +8 allowed (player decision 2026-11-22).
            { slot: "offhand", steps: [["quiver", 0], ["quiver", 7], ["quiver", 8]], for: "ranger", how: "craft: Armadillo Scale + 200 Bee Wings" },
            { slot: "orb", steps: [["orbg", 0], ["orbg", 1], ["orbof{stat}", 0]], alts: [{ item: "cave_loaded_die", how: "craft: 10 Cave Amber + 8 Seashells + 2 Reef Glass" }], how: "craft (Cole)" },
            // Rings (gear plan v2, 2026-11-22): main-stat rings +2 -> +4; then the crafted seals at +2 (12 main stat, beats a
            // ring +4 with 10 - compound items: +2 = 9 crafted copies). Sucker Punch is the ranger's only.
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
            // Ranger (gear plan v2): DEX belt +4, then the Wind Belt +2 (16 DEX like the belt +4, plus armor and speed).
            { slot: "belt", steps: [["dexbelt", 0], ["dexbelt", 1], ["dexbelt", 2], ["dexbelt", 3], ["dexbelt", 4], ["windbelt", 2]], replace: true, anytime: true, for: "ranger",
                how: "craft: DEX belt +2 + 40 storm feathers + 4 essence of ether" },
            // Tanks: Rugged set from armor boxes, +7 then +8 (gear plan v2), worn over the shop piece once the shop gear is done.
            { slot: "helmet", steps: [["helmet1", 7], ["helmet1", 8]], replace: true, for: "tank", how: "armor box" },
            { slot: "pants", steps: [["pants1", 7], ["pants1", 8]], replace: true, for: "tank", how: "armor box" },
            // Warrior gloves: Rugged +8, then the Fiery Gloves (+7, then +8 - never more than one level below).
            { slot: "gloves", steps: [["gloves1", 7], ["gloves1", 8], ["fierygloves", 7], ["fierygloves", 8]], replace: true, for: "warrior",
                how: "armor box / craft: gloves + 20 feathers + 2 essence of fire" },
            { slot: "gloves", steps: [["gloves1", 7], ["gloves1", 8]], replace: true, for: "paladin", how: "armor box" },
            // Warrior chest: Rugged +7, then Dracul's Attire from +7 (no stat drop below +7), then +8 slowly
            // (workshop.dailyTries: 3 tries a day). No Rugged Coat +8 - the Attire replaces it.
            { slot: "chest", steps: [["coat1", 7], ["mcape", 7], ["mcape", 8]], replace: true, for: "warrior", how: "armor box / drop: Dracul, Ms. Dracul" },
            { slot: "chest", steps: [["coat1", 7], ["coat1", 8]], replace: true, for: "paladin", how: "armor box" },
            { slot: "shoes", steps: [["shoes1", 7], ["shoes1", 8], ["wingedboots", 7]], replace: true, for: "tank", how: "armor box / craft: shoes + 20 magical feathers" },
            // Priest - the chest opener: Wanderer's pieces +8 (int) replace the shop pieces once its
            // own shop gear is done (player decision 2026-11-20). With the cap that is 4 pieces:
            // +10% gold on every chest it opens. Bases from Ponty (+0 copies are plentiful).
            // Shoes: Wanderer's Shoes +8 stand in for the Winged Boots (long to get) - the full set adds
            // +16 luck. Worn Winged Boots pause this chain; finished ones replace the stand-in (2026-11-20).
            { slot: "chest", item: "wattire", to: 8, replace: true, for: "priest", how: "Ponty / craft" },
            { slot: "pants", item: "wbreeches", to: 8, replace: true, for: "priest", how: "Ponty / craft" },
            { slot: "gloves", steps: [["wgloves", 8], ["fierygloves", 7], ["fierygloves", 8]], replace: true, for: "priest", how: "Ponty / craft" },
            // Ranger gloves (gear plan v2): Thundergrips, crafted from Gloves of the Hunter Ranger +6 (8 Monster Tokens).
            { slot: "gloves", steps: [["thundergrips", 7], ["thundergrips", 8]], replace: true, for: "ranger",
                how: "craft: hunter gloves +6 + 80 storm feathers + 12 essence of ether" },
            // Priest luck swap set (gear plan v2): carried, never worn by the equip pass - classes.priest.luckSwap puts them on
            // for the luck catch. The Wanderer's pieces are the chains above (kept in the bag once something else is worn).
            { slot: "orb", item: "rabbitsfoot", to: 0, carry: true, for: "priest", how: "120 Fun Tokens" },
            { slot: "offhand", item: "mshield", to: 7, carry: true, for: "priest", how: "10 Fun Tokens (after the Rabbit's Foot: workshop.tokenOrder)" },
            { slot: "earring", item: "cloverstud", to: 0, carry: true, count: 2, for: "priest", how: "craft: vit earring +2 + verdant core + 40 ash leaf + 40 spores + 5 green slime (x2, one per earring slot)" },
            // Ranger AoE (gear plan v2): Poucher and Alloy Quiver are held in the bag for a later AoE mode.
            { slot: "mainhand", item: "pouchbow", to: 7, carry: true, for: "ranger", how: "craft: bow + Pouch of Poof" },
            { slot: "offhand", item: "alloyquiver", to: 0, carry: true, for: "ranger", how: "drop: targetrons 1:4,000" },
            { slot: "shoes", item: "wshoes", to: 8, replace: true, for: "priest", how: "Ponty / craft",
                alts: [{ item: "wingedboots", how: "craft: Shoes + 20 Magical Feathers" }] },
            // Weapons: see gearPlan.weapons (item lists per class, 2026-11-21) - no stepped chains here any more.
            // Warrior Agitate mode: two orange Lolipop Maces carried in the bag; green ones stand in.
            { slot: "mainhand", item: "ololipop", to: 7, carry: true, count: 2, for: "warrior", how: "drop: Jr." },
            { slot: "mainhand", item: "glolipop", to: 7, carry: true, count: 2, insteadOf: "ololipop", for: "warrior", how: "drop: Green Jr." },
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
        elixirs: { off: true, note: "Not used for now (player decision 2026-11-19).", options: [{ item: "pumpkinspice", for: "physical" }, { item: "elixirluck", for: "priest" }] },
        // Weapons per class, left to right = better. The levels and the other classes are documentation
        // for the PDF; which weapon is made and upgraded follows gearPlan.weapons and materialGoals.
        // Read by the bot (workshop usedWeaponTypes, since 2026-11-20): the weapon types named here (plus
        // the worn ones) are the only ones a guide weapon wish or a Ponty find is rated for - no bows for
        // the dual-wielding warrior.
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
                    aoe: { mainhand: [["firestaff", 9], ["sparkstaff", null, "found"]], offhand: [["wbook0", 4]] },
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

    // Merchant: fulfil wishes from bag, bank or by upgrading own copies (approved 2026-11-15)
    workshop: {
        enabled: true,
        // Minimum success chance per step, by how the item is replaced (player decision
        // 2026-11-16, replaces the 40/60/70 % value tiers of 2026-11-15: losses are part
        // of the game, progression must not stall at +4..+6):
        // No floors at all since 2026-11-19 (player decision): a higher level is only worked on
        // once the level below is in hand, nothing in the gear plan is bad to lose, and grace
        // or primals rarely pay off - a failed step only costs the attempt. (Was: compound
        // 0.35, rare 0.5.) The value report (stage 2) will decide what is worth trying.
        risk: {
            shop: 0,               // re-buyable from an NPC
            compound: 0,           // compound items (three copies from drops)
            rare: 0,               // token / drop items (Hunter set, Phoenix weapons, ...)
            // Grace farming starts only when the chance is at most this far below the floor
            // (a sanity limit). How many grace stacks are built is decided by the fodder's own
            // success chance (grace.maxFodderChance, player decision 2026-11-16).
            graceWindow: 0.25,
            // No floor either (like shop gear): copies come from boxes we hold in numbers.
            free: ["helmet1", "gloves1", "pants1", "coat1", "shoes1",
                "ololipop", "glolipop"], // Lolipop Maces up to +7 like shop gear: (Green) Jr. drops one or two per kill
            maxScrollGrade: 2,     // try up to Rare scrolls when the normal one falls short
            // The next two apply only with scrollChoice.enabled false (scrollChoice below picks the scroll):
            // weapons nobody sells in normal grade use the High scroll (40k) from +4 -> +5 on.
            higherScrollFrom: 5,
            // Shop gear (armor and weapons) and other armor (Wanderer pieces): the High scroll from
            // +5 -> +6 on instead of the normal one - faster stages (player decision 2026-11-20).
            gearHighScrollFrom: 5,
            buyStrongerScrolls: true, // only within budgetPerWish; owned/banked ones are used first
        },
        // Cheapest scroll per step (player decision 2026-11-20, Earthiverse idea #3): expected gold =
        // (scroll + (1 - chance) x value of the lost copies) / chance, chances from the server's
        // formulas. Replaces higherScrollFrom / gearHighScrollFrom above (used only with enabled: false):
        // shop gear takes the normal scroll up to +7 (helmet to +8: ~1.7M instead of ~3.8M), valuable
        // copies (drops, earrings at their sell price) get the higher one where it saves gold.
        // A +0 copy no shop sells: max(drop hours x team gold/h, game value x valueFactor); unknownValue without either.
        scrollChoice: { enabled: true, valueFactor: 3, unknownValue: 1000000 },
        // A drop counts as farmable up to this many hours per copy (2026-11-20); beyond, its own cost is
        // unknown (no buy order at own cost) - Orange Lollipops "dropped" every 48 billion s and counted as free.
        dropNeverHours: 1000,
        // Gold per wish (base item + scrolls, failures included): shop gear vs token/drop
        // items (player decision 2026-11-16: room for Rare scrolls, 1.6M each).
        budgetPerWish: {
            shop: 1000000, rare: 4000000,
            // Per item, e.g. { waxe: 4000000 } (the Wooden Axe plan was dropped 2026-11-17).
            // Wanderer's pieces to +8 from Ponty copies (~24k each, many burnt on the way): 2026-11-20.
            byItem: { wattire: 8000000, wbreeches: 8000000, wgloves: 8000000, wshoes: 8000000 },
        },
        massSkills: true,             // Mass Production / Mass Exchange before upgrades and exchanges
        mainStatOnArmor: true,        // wished armor always gets the class's main stat scroll
        deliveryBatchMs: 10 * 60 * 1000, // finish the open wishes first; a ready item waits at most this long
        giveUpForMs: 60 * 60 * 1000,  // after a stop (risk/no source/wish budget used up) retry in an hour
        retryAfterBudgetMs: 10 * 60 * 1000, // ...but only 10 min when we merely lack gold right now (or the bag is full)
        bagReserve: 2,                // copies come out of the bank only while this many bag slots stay free (8 -> 2 on 2026-11-23: the merchant banks before every pickup anyway)
        bankScanEveryMs: 10 * 60 * 1000,
        // Value report (stage 1, player request 2026-11-19): logs gain, cost and gain per hour of
        // every open wish plus the fighters' XP value - no decisions are made from it yet.
        // orderWishes (stage 2, player decision 2026-11-19): open wishes are worked on by value.
        valueReport: { enabled: true, everyMs: 15 * 60 * 1000, top: 6, orderWishes: true },
        // Ponty / player stands (player decision 2026-11-21): base copies of a wished drop or craft are
        // bought until the chances of the copies we hold to reach the wished level add up to
        // baseTargetPieces finished pieces (a +6 counts its ~25 %, a +0 its ~5 %) - at most maxBaseCopies.
        baseTargetPieces: 1,
        maxBaseCopies: 20,
        redeliverAfterMs: 6 * 60 * 60 * 1000, // don't fulfil the same wish for a fighter again within 6 h
        // Grace farming (approved 2026-11-15): before a compound/rare item is risked at a
        // level whose chance is too low, cheap shop items are failed at that level to raise
        // the player's grace for it. The real preview decides when it is enough.
        grace: {
            enabled: false,          // off since 2026-11-19 (player decision: no floors, no grace preparation)
            minLevel: 4,             // only for steps to +4 and higher
            fodder: "wbasher",       // cheap upgradeable shop item no gear goal uses (Wooden Basher, 4,900 gold)
            // Gold per target level per 24 h (fodder + scrolls): incomeShare of the merchant's
            // net income over 24 h (player decision 2026-11-16; ~15M/day -> ~750k), at least
            // budgetPerLevel.
            incomeShare: 0.05,
            budgetPerLevel: 300000,
            maxAttempts: 25,         // fodder attempts per farming round
            // Grace stacks only while the fodder itself would fail more likely than not: stop
            // when its own chance at the target level is above this - now, or by the time the
            // stacks still needed are built (measured gain per stack). A success resets them.
            maxFodderChance: 0.5,
            batch: 5,                // helmets prepared at once, then attempted back to back
        },
        // Ladder pot (player decision 2026-11-17): its own share of the last 24 h of income - it scales with
        // the account and is not stopped by the gear goals. The weapon ladder it was made for is gone
        // (2026-11-22: all its weapons are on the dismantle list); it pays the material goals now
        // (materialGoals ... budget: "ladder"). Optional extra: { amount, until } on top.
        bruteForce: { incomeShare: 0.25 },
        // Box armor (player decision 2026-11-17): while a fighter wishes any Rugged piece,
        // every spare copy from the armor boxes is upgraded towards upTo at once - failures
        // free bank slots and the next chain pieces are ready early (the bank has ~19 free
        // slots; a new pack costs 75M).
        // Once a piece is worn (or held) at upTo and nobody wishes it, new copies are sold.
        boxArmor: { names: ["helmet1", "gloves1", "pants1", "coat1", "shoes1"], upTo: 8 }, // +8 since 2026-11-22 (gear plan v2)
        // At most this many upgrade tries per day for "item:level" (2026-11-22, player decision): Dracul's Attire +8 -
        // few copies, so 2-3 tries a day instead of burning them all at once.
        dailyTries: { "mcape:8": 3 },
        // Who gets a shared material first (2026-11-22, player decision): a recipe waits while an item listed before it is
        // still wished. Recipes that are no weapons also wait while the material's weapon goals (materialGoals) are open -
        // essence of fire goes to the fire weapons first.
        materialOrder: { essenceofether: ["thundergrips", "moonshardearring", "windbelt"] },
        // Token purchases in this order (2026-11-22, player decision): Fun Tokens for the Rabbit's Foot (120, one buy, a
        // big step) before the Shield M (10 each, but every failed upgrade costs another).
        tokenOrder: { funtoken: ["rabbitsfoot", "mshield"] },
        // Drop weapons (player decision 2026-11-15): a weapon we hold that beats a fighter's
        // worn weapon goes to that fighter; if none does yet, the best copy is upgraded to the
        // first level that would. A failure only costs a drop - the fighter keeps its weapon.
        // Since 2026-11-21 a class with a gearPlan.weapons list (warrior, priest, ranger, rogue - all
        // of ours) is planned by that list (caps: gearPlan.weaponCaps) and materialGoals; names,
        // maxLevel and buy below only matter for a class without a list. margin counts everywhere,
        // craft also for list items not made from a material. enabled: false stops the list and name
        // plans (not the material goals).
        betterWeapons: {
            enabled: true,
            names: ["fireblade", "firestaff", "firebow", "concordmace", "maceofthedead", "staffofthedead", "bowofthedead",
                "daggerofthedead"], // daggers for the rogue (2026-11-18: bought at Ponty)
            maxLevel: 7,
            margin: 0.03,   // at least 3% stronger than the worn weapon
            // Next weapon step (player decision 2026-11-16; classes without a weapon list): once a
            // fighter's weapon (shop or fire) is at gearGoals.upTo, its "of the Dead" weapon is crafted
            // (Bones from Zombies + a shop weapon + fee) and upgraded until it is stronger. With a
            // list the Bones go by materialGoals (mbones).
            // Paused 2026-11-19 (player decision): the first Bones are kept, nothing crafts with them.
            // Gear plan (player decision 2026-11-19): Bones go to Daggers of the Dead for the rogue.
            craft: ["daggerofthedead"], // was ["maceofthedead", "staffofthedead", "bowofthedead"]
            // Bought with tokens when we hold none (player decision 2026-11-16: the Concord
            // Mace first - a paladin's mace beats the fireblade +7 already at +4).
            buy: [], // concordmace paused 2026-11-16 (no paladin; shop +9 first)
            // Token weapons are not cheap to lose: each step needs this chance.
            minChance: {},   // no floors since 2026-11-19 (was concordmace 0.5)
        },
        // Gear goals (approved 2026-11-15): when idle, the merchant pushes the fighters' worn
        // shop armor and selected weapons to `upTo`. Shop armor is re-buyable, so every
        // attempt is made whatever its chance: a failure only costs gold and raises the
        // grace for that level (for every item), a success is a finished piece. The finished
        // copy gets the fighter's stat scroll (str/int/dex) and is delivered; the fighter's
        // guide equips it and the old piece comes back as a base for the next copy.
        // Drop weapons are not re-buyable: they follow gearPlan.weapons and materialGoals instead
        // (gearGoals.weapons is empty).
        // The workshop (wishes, gear goals, grace) never spends below this (player
        // decision 2026-11-16, together with the income-based gear-goal budget).
        // Since 2026-11-19 (player decision, fresh account): 20 % of the highest merchant gold of the
        // last 24 h, at most 5M (was a fixed 5M - nothing was ever spent on a new account).
        keepGold: { share: 0.2, max: 5000000 },
        // Bonus wishes (no measurable gain, e.g. the priest's Wanderer set): one unit of work every everyMs
        // while other wishes are open - they used to wait for a moment when everything else was blocked
        // (player decision 2026-11-21).
        bonusWishes: { everyMs: 3 * 60 * 1000 },
        gearGoals: {
            enabled: true,
            // Since 2026-11-15 (player request): don't let armor and weapons wait while the guide
            // works on accessories - worn shop armor and shop weapons go up in parallel (stages
            // below, weapons to upTo), with the class's main stat. Weapons come first, armor
            // follows once no weapon step is open (player request 2026-11-15).
            fromLevel: 0,
            // Shop weapons to +8 (gear plan, player decision 2026-11-19) - only while no better
            // weapon is worn: a Fiery Blade +7 already beats a Blade +8, so it counts as done.
            upTo: 8,                  // weapons and the "shop gear done" mark for class wishes
            // Armor in stages (player decision 2026-11-16): ALL of a fighter's shop armor
            // reaches a stage before any piece goes on to the next. From +7 each level adds
            // +3 main stat. Guide estimate per piece from scratch: +8 ~170 copies / 1.1M,
            // +9 ~2400 copies / 17M, +10 ~100,000 copies / 770M. Capped at +8 (player
            // decision 2026-11-16: 170 -> 2400 copies is too steep; armor boxes / Rugged next).
            // Since 2026-11-20 (player decision) the stages are team-wide: every fighter's shop gear
            // reaches +7 before anyone goes on to +8.
            stages: [7, 8], // shop weapons run through the stages too (player decision 2026-11-19)
            // Per-piece caps above the last stage (2026-11-22, gear plan v2): once the whole team is through the stages,
            // these worn shop pieces go on to this level - the ranger's coat to +9.
            capBy: { ranger: { chest: 9 } },
            everyMs: 3 * 60 * 1000,   // one gear-goal step this often even while wishes are open
            // offhand: a second shop weapon (dual wield) goes to upTo too, so a fresh warrior
            // reaches the Wooden Axe wish (both hands +7); shields, books, quivers stay out.
            slots: ["helmet", "chest", "pants", "shoes", "gloves", "mainhand", "offhand"],
            weapons: [], // drop weapons: materialGoals and gearPlan.weapons
            // Daily budget from income (player decisions 2026-11-15/19): every gold rise of the
            // merchant over the last 24 h is income (booked directly: fighter handovers, sales),
            // minus consumables (potions, buy-order materials). One gear pot: wishes, weapon
            // plans, stock rules and stat scrolls pay from it as well as the gear goals and
            // Ponty; budgetPerWish is only a safety cap. No fixed total since 2026-11-16 (player decision): long-term
            // positive cash flow, with workshop.keepGold as the floor. `total` (optional)
            // would cap everything ever spent on gear goals.
            budget: {
                incomeShare: 0.7, // transferAbove removed 2026-11-19 (direct booking, player decision)
                // Optional (the old ones expired and were removed 2026-11-22):
                //   extra: { amount, until } - a player-granted amount on top until that time (counts against
                //          the last 24 h of spending);
                //   resetAt: "ISO time" - one-time fresh start of every pot (gear goals, ladder, grace): spending
                //          and gold samples before it are ignored; no effect once 24 h have passed.
            },
        },
        // Fixed wishes on top of the guide's. Items without a shop are bought with tokens
        // (Monster Tokens at Daisy). Steps below the risk tier are not attempted: the copy
        // is delivered at the level reached and the fighter's guide decides whether to wear it.
        // e.g. DmpxPala: [{ name: "concordmace", level: 4 }]
        wishes: {},
        compound: {
            auto: true,   // combine spare accessories/books when no wish is open
            autoUpTo: 3,  // ...up to this level (each step still needs the risk tier's chance)
            // Copies held back from auto compounding ("name:level": count). DEX belts +2 are the
            // ranger's belt and the base of the rogue's Knife Belt (2026-11-18): a try at +3 only
            // with five spare ones.
            keep: { "dexbelt:2": 2 },
        },
        // Exchange (approved 2026-11-15: everything except seasonal items).
        exchange: {
            enabled: true,
            // armor boxes stopped 2026-11-15 (their rewards only filled the bank);
            // leather (40 -> mostly a Cape) added 2026-11-16 for the cape class wish
            items: ["gem0", "gem1", "seashell", "leather"],
            // Opened only when a wished item comes out of them (Rugged armor), a few at a
            // time and only while the bank has room for the other rewards (2026-11-16).
            onDemand: ["armorbox"], onDemandBatch: 3, onDemandBankFree: 10,
            // Hoarded, not exchanged or opened (player decision 2026-11-17: collect gems and
            // boxes from CGoo, then exchange, open and upgrade in one big batch). Empty the
            // list for the big batch.
            // armorbox off the list 2026-11-18 (player decision): the boxes open on demand again
            // for the warrior's Rugged pants1/shoes1 +7.
            hold: ["gem0", "gem1", "marketparcel"], // + Merrit's parcels (collected first, 2026-11-17)
            batch: 10,     // exchanges per round, so deliveries are not delayed for long
            keepFree: 8,   // stop while fewer bag slots are free (rewards need room)
        },
    },

    // Merchant role
    merchantRole: {
        // The merchant's own wish list (player decision 2026-11-17): things he needs himself,
        // made the same ways as the fighters' wishes - bought (stand at Divian), crafted at Leo
        // (Fishing Rod, Pickaxe: shop staff/blade + Spider Silk), and a missing drop ingredient
        // is reported as a shortage, so a fighter farms it (spiders). Kept in his bag, never
        // delivered, sold or banked; a broken tool (1% per catch) is simply wished again.
        // Cheap and needed early: they come before the fighters' wishes and only keep the
        // potion reserve, not workshop.keepGold.
        ownWishes: [
            { name: "stand0" },       // market stand (buy orders, Merrit's parcels)
            { name: "rod" },          // fishing: Rugged pieces
            { name: "pickaxe" },      // mining (later: the Mining Tunnel has moles)
        ],
        // Gathering with the merchant's own tools, whenever its cooldown is over.
        gather: {
            // Mainland pier by the fisherman: water within 24 px (server). One catch per
            // 48 min (10% per cast), 99.5% a Rugged piece.
            fishing: { enabled: true, spot: { map: "main", x: -1560, y: 470 }, maxCasts: 40 },
        },
        // Market stand (player decision 2026-11-17): with a Merchant Stand (stand0, bought by
        // hand) the merchant's home is a spot on the town square with the stand open - buy
        // orders for what we want, and Merrit's hourly Market Parcel for keeping a shop there
        // two minutes. From there upgrade, compound, Xyn, Lucas and the potion shop are within
        // the server's 400 px, so he only closes the stand for the bank, deliveries and crafts.
        // Square: x -240..240, y -120..144; 40+ px from fixed NPCs (Merrit's rules).
        stand: {
            enabled: true,
            home: { x: -120, y: -112 },
            reach: 390,               // NPCs this close are used without walking (server: 400)
            // Buy and sell orders: config.market at the top.
        },
        // Potion stock: potions.target per fighter using a size (at most stockPerPotion),
        // only built while we have stockFromGold - below that, gold goes to equipment
        // first and deliveries buy just what is needed.
        stockPerPotion: 1000,
        stockFromGold: 100000,
        goldReserve: { ratio: 0.2, min: 0, max: 1000000 }, // never spend below 20% of our gold (max 1M)
        handoverWaitMs: 10000,               // wait next to the fighter for its loot
        // A pickup follows the fighter (its newest position) and re-routes once it moved more
        // than retargetPx away; gives up after followMs (player decision 2026-11-17).
        followMs: 4 * 60 * 1000,
        retargetPx: 150,
        // Items the merchant sells to NPCs.
        // A plain name sells only +0 copies. { name, maxLevel } also sells
        // upgraded copies up to that level. Shiny and locked items are never sold.
        // Anything an NPC shop sells is not worth storing at +0: sell it (approved
        // 2026-11-15). Consumables and scrolls are excluded; upgraded copies are kept.
        sellBuyable: {
            enabled: true,
            maxLevel: 0,
            exceptTypes: ["pot", "uscroll", "cscroll", "pscroll", "offering", "stand", "elixir", "booster", "tome", "qubics"],
        },
        // Phoenix and event weapons are never on this list - they can't be bought again.
        sellList: [
            // junk drops. Craft ingredients (spores, crab claws, frog tongues, ascale,
            // bear fur, white eggs, carrots, vit scrolls) are kept since the
            // fresh start (2026-11-15): Cole and Leo craft gear from them.
            "slimestaff", "mushroomstaff",
            { name: "stinger", maxLevel: 2 }, // +3 and up are rogue daggers now (2026-11-18)
            // Wanderer's set: sold only when no fighter can use the copy (workshop.equivalentWanted).
            "wcap", "wshoes", "wattire", "wbreeches", "wgloves",
            // +0 weapons (approved 2026-11-15). Phoenix weapons (fireblade, firestaff,
            // firebow) are never sold - player decision 2026-11-15.
            // "dagger" kept since 2026-11-19 (player decision: no investment, but not sold either)
            "snowball",
            // V1 upgraded short swords to +4 - no longer needed (approved 2026-11-15)
            // Short Swords are no longer sold (2026-11-19): the base of the Sword of the Dead.
            // the Paladin's old starter gear (approved 2026-11-15).
            // Accessories (rings, belts, amulets, earrings) and books are NOT sold:
            // they are compound/upgrade material the progression guide asks for -
            // except the HP/VIT ones no class or guide wants (approved 2026-11-16; any
            // level: compounding them first loses gold on average). Worn copies stay.
            { name: "hpamulet", maxLevel: 10 },
            // vitearring off the list 2026-11-20 (player decision): players bid up to 1M for +0 and
            // 10-15M for +2 (NPC: a few 10k). Kept until selling to players by level is decided.
            { name: "vitring", maxLevel: 10 },  // STR beats VIT for the warrior too (player decision 2026-11-16)
            { name: "hpbelt", maxLevel: 10 },   // stat belts replace them (2026-11-19); a worn copy stays
            { name: "helmet", maxLevel: 3 },
            // Shop weapons and the old quiver that did their job (player decision 2026-11-16):
            // fire weapons replaced them, the ranger wears a quiver +8. A copy a fighter or
            // its guide wishes for is never sold (isReserved).
            { name: "mace", maxLevel: 7 },
            { name: "staff", maxLevel: 7 },
            { name: "blade", maxLevel: 5 },
            { name: "quiver", maxLevel: 2 },
            // Materials without a plan (player decision 2026-11-16). Kept on purpose: green
            // slime, ashleaf (Thistle Quiver), bat wings, spores (Oathplate), reef glass,
            // carrots (Carrot Sword).
            // Snake Fangs are no longer sold (2026-11-17): a player buys them for 3M each.
            // embercoal off the list 2026-11-23 (player decision): a Witch's Cipher ingredient (with frostscale,
            // gloomfeather, verdantspore - none of them is ever sold). They drop only during the event's gathering
            // phase and don't spoil, so the stock is kept for the cauldron and the Witch's recipes.
            "rattail", "smush",
            "cclaw",   // Crab Claw (fist weapon, 12 attack) - player decision 2026-11-17
            "vitscroll", "lspores", // VIT stat scrolls (we use STR/INT/DEX; the shop sells them), Large Spores - 2026-11-17
            // Rugged and Heavy armor (armor boxes) are no longer sold since the fresh start:
            // craft bases (Oathplate, Resolute Sallet, class boots) and upgrades (2026-11-16).
        ],
        // Items the merchant hands to a fighter on its next delivery (one-off gifts).
        give: {
        },
        // Every online fighter gets one of these if it carries none - from the bank, else bought
        // with tokens (Tracktrix: 4 Monster Tokens at Daisy). Tracktrix: monster achievement
        // bonuses only apply while it is carried, and it calls the Cavalry.
        onePerCharacter: ["tracker"],
        // The merchant keeps no copy for itself (player decision 2026-11-19: 3 for 12 tokens).
        onePerCharacterKeepOwn: false,
        // Merchant's Luck (player decision 2026-11-20): ourselves, our fighters and every other
        // non-merchant player in reach (2 % chance of a copy of what they loot). Ours is renewed
        // below refreshBelowMs; strangers' "strong" mluck (their own merchant's) is left alone.
        mluck: { enabled: true, strangers: true, refreshBelowMs: 30 * 60 * 1000, mpReserve: 100 },
        // Ponty round over other servers (player decision 2026-11-20): at full local hours every
        // everyHours (0 = off, e.g. 3 -> 0, 3, 6, ... o'clock) and once at testAt, the merchant
        // serves every fighter, banks, then visits Ponty on each server (wishes and finds, the
        // usual price and pot rules) and comes home. The hop is done by the client hosting the
        // merchant's bot window (main.js hop watcher).
        pontyRound: {
            enabled: true,
            // Home = the server the leader runs on (util.teamServer, 2026-11-21); this one only
            // until the leader's first heartbeat is stored.
            home: ["EU", "III"],
            // Every server, the PvP ones too (player decision 2026-11-20: worth the risk of being
            // attacked there). The home server is skipped automatically.
            servers: [["EU", "I"], ["EU", "II"], ["EU", "III"], ["EU", "IV"], ["US", "I"], ["US", "II"], ["US", "III"], ["US", "IV"], ["US", "V"], ["ASIA", "I"], ["ASIA", "II"],
                ["EU", "PVP"], ["US", "PVP"]],
            everyHours: 1,                     // every full hour local time (player decision 2026-11-21: a round takes ~5 min; was 3)
            testAt: null,                      // one extra round at this ISO time (the first test ran 2026-11-20 16:47Z)
            prepMaxMs: 8 * 60 * 1000, hopTimeoutMs: 2 * 60 * 1000,
        },
        // Skill ingredients go to the class that uses them on every delivery.
        classItems: { priest: ["essenceoflife"], ranger: ["poison"] },
        // Bank: when the bag runs low on space, everything that is neither sold
        // nor kept below goes into the bank (auto placement, stacks merge).
        // New bank packs are never bought automatically.
        bank: {
            whenFreeBelow: 6,
            // Below this many free bag slots the workshop's idle stock (copies waiting for a compound/upgrade) is banked
            // as well; the workshop takes it out again when it works on it (2026-11-23, player decision).
            stockFreeBelow: 15,
            // Before each pickup: bank first while fewer slots are free (store only, workshop copies too;
            // 2026-11-22: back-to-back pickups failed with send_no_space). 0 = off.
            beforePickupFree: 12,
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
