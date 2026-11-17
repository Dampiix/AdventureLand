// =====================================================================
// bot_config – everything you are expected to tweak lives here.
//
// To run a different team (e.g. brand-new level-1 characters) only the
// `team` block needs to change. Classes come from character.ctype, so any
// class works; paladin, priest, mage and ranger have skill modules.
// =====================================================================

module.exports = {
    version: "1.63.0",

    team: {
        // Fresh save (2026-11-15). The old characters DampiixWar, Dampiix, DampiixPri and
        // Dampiiix are an item archive: never list them here, the bot would hand their
        // items to the merchant.
        // 2026-11-16: the paladin DmpxPala is replaced by the warrior DmpxWar (taunt, cleave).
        // Party since 2026-11-16: the priest leads (picks the spots, ranged), the warrior
        // tanks with Taunt.
        // Solo since 2026-11-16 (XP test: the warrior alone with Lone Wolf made 24.3M XP in
        // 30 min, the whole party 16.2M): the warrior levels ahead as the tank. Back to the
        // party: leader "DmpxPriest", phase "party".
        leader: "DmpxWar",
        fighters: ["DmpxPriest", "DmpxWar", "DmpxRanger"],
        merchant: "DampiixMerch",                       // null for no merchant
        farm: {},                                       // optional per-character farm override, e.g. { DmpxRanger: "bee" }
    },

    // "solo":  only the leader fights (Lone Wolf bonus); the merchant still supports it.
    // "party": all fighters form a party around the leader.
    phase: "solo",

    party: {
        followDistance: 80,   // members idle within this distance of the leader
        leash: 300,           // members drop everything and catch up beyond this
        broadcastMs: 2000,    // leader shares position/target this often
        inviteEveryMs: 10000, // leader re-invites a missing member this often
        // Easy farm targets: members pick their own monster near the leader instead
        // of only assisting (e.g. a 500-goo hunt).
        spread: { enabled: true, maxHits: 3, maxDamageRatio: 0.05 },
    },

    tickMs: 250,

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
            crabxx: "never", franky: "never", icegolem: "never",
            horseman: "never", abtesting: "never",
            graveyard: "always",          // Halloween: zombies/ghouls in Spooky Town's graveyard – Bones (2026-11-16)
        },
        // "always" only applies once every fighter has reached this level
        minLevel: { phoenix: 40, goobrawl: 20, snowman: 10, graveyard: 40, mvampire: 50 },
        search: ["phoenix", "mvampire"], // roaming bosses the leader looks for
        // Search again this long after a miss or a kill (player decision 2026-11-15: 30 min,
        // the walk costs farm time). Respawn times (game source): the Phoenix (respawn 32)
        // comes back ~32 s after its death at a random one of its 5 spots; Dracul (1080)
        // after 13-22 min.
        searchEveryMs: 30 * 60 * 1000,
        // Bosses hunted nonstop: searched again after farmBossEveryMs (player option
        // 2026-11-16; Phoenix: weapons and earrings, about half the XP/h of crocs).
        farmBosses: [],                 // e.g. ["phoenix"]
        farmBossEveryMs: 60 * 1000,
        searchSpotMs: 4000,             // look around this long at each spawn area
        // Boss check (bosses only; the guide never calls them safe): from everyone's stats
        // and the game's damage formula. Other players are not counted on.
        boss: {
            minHits: 6,                 // every fighter must survive this many hits in a row
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
        enabled: true,
        minLevel: 20,                    // only once every fighter has this level (Daisy ignores our level)
        allow: [],                       // always hunt these, even if the guide calls them unsafe
        deny: [],                        // never hunt these
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
        // their best source – Irradiated Goo (gems -> 21 % box) – if it is safe and fast enough.
        want: [{ name: "armorbox", copies: 50 }],
    },

    targeting: {
        farm: null,              // e.g. "squigtoad" to force a monster for everyone (null = guide)
        fallback: "goo",          // used when the progression guide has no answer
        // Farm only where every fighter's own guide calls the spot safe; routes the guide
        // only offers as a careful trial count once proven – by the guide's own fights, or
        // by 15 min of team farming there without a death (remembered across restarts).
        avoidTrial: true,
        // Melee classes never hit monsters returning this much damage (dreturn in %, porcupine
        // 4800 = 48x back – one hit kills a warrior; armadillo 30 is fine). Ranged ones farm them.
        // Lowered to 20 (2026-11-16): armadillos (30 %) nearly killed the solo warrior – his
        // dual-wield hits and Cleave on several of them came back faster than potions heal.
        melee: { classes: ["warrior", "paladin", "rogue"], maxDreturn: 20 },
        // The current farm spot is left only when a member's "unsafe" lasts this long
        // (verdicts near the edge flip back and forth); a death there counts at once.
        objectionGraceMs: 5 * 60 * 1000,
        // Team model (on since 2026-11-16, a test with the warrior as tank): a spot
        // counts as safe when the party can take it together – the tank survives tankHits
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
            // Aggressive monsters whose spawn area per monster is below this (px²) come as a
            // whole pack (vampire rats: 5 in 150x195 wiped the team, 2026-11-16).
            denseArea: 15000,
            abilities: [],                 // monster abilities we accept (others: the guide decides)
        },
        // Monster levels (player request 2026-11-16): from this level a monster is checked
        // again with its real stats before we pull it (team model, else its damage per
        // second must stay within tolerance x the level-1 monster's).
        live: {
            fromLevel: 2,
            ownHits: 6,           // members/solo picking their own target: survive this many real hits
            // Solo: the HP lost over the whole fight (real damage/s minus own healing: a potion
            // per cooldown, priest self-heals, lifesteal, for the time we need to kill it) must
            // stay below this share of max HP.
            soloHpUse: 0.5,
            waitTolerance: 2.5,   // leader while the team stats are not in yet (level-5 CGoo: 1.9x)
        },
        refreshMs: 5 * 60 * 1000, // how often to ask the guide again
        crowdedAfterMs: 90 * 1000,    // no free target this long on the farm map -> spot is crowded
        // ...or this share of a window without a free target (other players leave us only
        // the odd monster, e.g. one per minute):
        crowdedWindowMs: 3 * 60 * 1000, crowdedIdleShare: 0.7, // idle = not in range of a target (walking counts)
        crowdedForMs: 60 * 60 * 1000,  // then use the guide's next choice for this long,
        crowdedMaxMs: 6 * 60 * 60 * 1000, // doubled each time the same spot is crowded again within a day
    },

    combat: {
        potionHpBelow: 0.8,      // below this: an HP potion on every cooldown (player decision 2026-11-16, was 0.45)
        potionMpBelow: 0.3,
        // Otherwise drink as soon as a whole potion's worth is missing (HP before MP), i.e.
        // on every cooldown in a long fight (player request 2026-11-16).
        potionWhenMissing: true,
        // With a priest in the party close by (or as the priest): potions only as an
        // emergency, the healing does the rest (player decision 2026-11-16).
        withHealer: { potionHpBelow: 0.6, potionWhenMissing: false },
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
            useCurse: true, mpReserveRatio: 0.4,
            useRevive: true,                // revive fallen members (consumes an Essence of Life)
            // Absorb Sins (lvl 55): emergency only – a member below `below` with monsters on it
            // and no warrior/paladin within Taunt range of it; only while we are above selfAbove.
            absorb: { enabled: true, below: 0.35, selfAbove: 0.6 },
            // Dark Blessing (lvl 70): +25% party damage for 8 s on targets needing sturdyHits+
            // of our hits, and on bosses.
            darkBlessing: { enabled: true, sturdyHits: 10 },
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
            taunt: { enabled: true, allyHpBelow: 0.8, hitRatio: 0.05 },
            agitateFrom: 3,                 // Agitate (lvl 68) when this many monsters are on allies
            cleaveFrom: 3,                  // Cleave (lvl 52, axe/scythe) with this many monsters around
            stompFrom: 2,                   // Stomp (lvl 52, basher) with this many attackers
            sturdyHits: 4,                  // War Cry (lvl 70) on targets needing this many hits
            hardShell: { enabled: true, below: 0.45 }, // lvl 60, against physical hits
            useCharge: true,                           // +30 speed whenever we walk (on cooldown)
            // Dash: the server accepts a point at most 50 px away (game source) – a 120 MP hop,
            // no gap closer. Off since 2026-11-16 (the old 150 px jumps always failed).
            dash: { enabled: false, from: 120, max: 45, everyMs: 2000 },
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
        pickupEveryMs: 15 * 60 * 1000,   // ask for a routine pickup this often
        firstPickupAfterMs: 60 * 1000,   // first routine pickup this long after the bot starts
        requestEveryMs: 60 * 1000,       // don't spam the merchant
        merchantTimeoutMs: 3 * 60 * 1000 // no answer for this long -> buy potions yourself
    },

    // Fighters: equipment wishes from the progression guide + auto-equip
    gear: {
        enabled: true,
        wishEveryMs: 5 * 60 * 1000, // re-read the guide and resend wishes this often
        maxWishes: 8,   // a longer list shifts less (the merchant works through it one by one)
        // Wishes per class ("all" = every class) for slots the guide leaves empty. An entry
        // is one item or a chain { steps: [...] }: only the first step the worn piece does
        // not reach is wished, a piece of a later step (e.g. a lucky drop) counts for the
        // earlier ones and is equipped over them. A slot holding something outside the
        // entry is left alone. Not counted as gear goals (no further upgrades).
        // Active again since 2026-11-16 (player decision). Rugged armor (armor boxes) comes
        // after the shop armor: wished only once ALL shop gear is done (+8 armor, +7 weapon),
        // kept by the merchant until +7 and then worn over the shop piece (replace).
        // Helmet, gloves, pants first: most common in boxes, and 3 pieces give +20/+20.
        // Tanks only (player decision 2026-11-16): Rugged +7 has 10 main stat, shop +8 has 12,
        // so the priest and ranger keep their shop +8 (damage/healing); the warrior trades
        // 2 STR per piece for ~3x the armor and resistance.
        // The Monster Hunter sets are long-term and stay out for now.
        classWishesEnabled: true,
        // Belts (player decision 2026-11-17): tanks keep an HP belt and take it to +2 (+640 HP:
        // what booboos/stoneworms need) – while that wish is open the merchant keeps every HP
        // belt for compounding instead of selling it; afterwards the rest is sold again.
        // Priest and ranger: a main-stat belt (+4 at +0, +10 at +2) replaces the HP belt right
        // away. Stat belts only drop in Spooky Town (map drop) – the wish waits until a spot
        // there is safe.
        // Rings (player decision 2026-11-16): two stat rings +2 in the class's main stat
        // (+6) replace the Rings of Small Joys +2 (+3 STR/INT/DEX, +15 resistance) – at +0/+1
        // they are no better. Delivered only complete (+2), worn over a Ring of Joy right away
        // (anytime: no wait for the shop gear). Copies: Winterland map drop (statring table).
        classWishes: {
            all: [
                { name: "cape", level: 0 },      // 40 Leather -> exchange (wolves, boars)
            ],
            // Orbs: Orb of Beginnings (Cole: ascale + pleather + cscale + Bee Fur) to +1 first
            // (+3 to every main stat, 3 copies), then the class orb (+4 main stat already at +0).
            paladin: [
                { steps: [{ name: "orbg", level: 0 }, { name: "orbg", level: 1 }, { name: "orbofstr", level: 0 }] }, // Fire Spirit
                { steps: [{ name: "strring", level: 2 }], replace: true, anytime: true },
                { steps: [{ name: "hpbelt", level: 1 }, { name: "hpbelt", level: 2 }] },
                { steps: [{ name: "helmet1", level: 7 }], replace: true },
                { steps: [{ name: "gloves1", level: 7 }], replace: true },
                { steps: [{ name: "pants1", level: 7 }], replace: true },
                { steps: [{ name: "coat1", level: 7 }], replace: true },
                { steps: [{ name: "shoes1", level: 7 }], replace: true },
            ],
            priest: [
                { steps: [{ name: "orbg", level: 0 }, { name: "orbg", level: 1 }, { name: "orbofint", level: 0 }] }, // big Pom Pom (level2n)
                { steps: [{ name: "intring", level: 2 }], replace: true, anytime: true },
                { steps: [{ name: "intbelt", level: 0 }, { name: "intbelt", level: 1 }, { name: "intbelt", level: 2 }], replace: true, anytime: true },
            ],
            // The offhand is a second weapon (dual wield, handled by gear/workshop).
            // Monster Hunter Warrior set: long-term, paused (entries: mwhelmet 7, mwgloves 8,
            // mwpants 11, mwarmor 12, mwboots 15 tokens; replace at +7).
            warrior: [
                { steps: [{ name: "orbg", level: 0 }, { name: "orbg", level: 1 }, { name: "orbofstr", level: 0 }] }, // Fire Spirit
                { steps: [{ name: "strring", level: 2 }], replace: true, anytime: true },
                { steps: [{ name: "hpbelt", level: 1 }, { name: "hpbelt", level: 2 }] },
                { steps: [{ name: "helmet1", level: 7 }], replace: true },
                { steps: [{ name: "gloves1", level: 7 }], replace: true },
                { steps: [{ name: "pants1", level: 7 }], replace: true },
                { steps: [{ name: "coat1", level: 7 }], replace: true },
                { steps: [{ name: "shoes1", level: 7 }], replace: true },
            ],
            ranger: [
                // Cole: 1 Armadillo Scale + 200 Beewings (scorpions drop it too). The +7 is built on
                // a second copy; the worn +0 stays until it is done.
                { steps: [{ name: "quiver", level: 0 }, { name: "quiver", level: 7 }] },
                { steps: [{ name: "orbg", level: 0 }, { name: "orbg", level: 1 }, { name: "orbofdex", level: 0 }] }, // Fire Spirit
                { steps: [{ name: "dexring", level: 2 }], replace: true, anytime: true },
                { steps: [{ name: "dexbelt", level: 0 }, { name: "dexbelt", level: 1 }, { name: "dexbelt", level: 2 }], replace: true, anytime: true },
            ],
        },
    },

    // Merchant: fulfil wishes from bag, bank or by upgrading own copies (approved 2026-11-15)
    workshop: {
        enabled: true,
        // Minimum success chance per step, by how the item is replaced (player decision
        // 2026-11-16, replaces the 40/60/70 % value tiers of 2026-11-15: losses are part
        // of the game, progression must not stall at +4..+6):
        risk: {
            shop: 0,               // re-buyable from an NPC: no floor (the budgets cap the gold)
            compound: 0.35,        // compound items (three copies from drops)
            rare: 0.5,             // token / drop items (Hunter set, Phoenix weapons, ...)
            // Grace farming starts only when the chance is at most this far below the floor
            // (a sanity limit). How many grace stacks are built is decided by the fodder's own
            // success chance (grace.maxFodderChance, player decision 2026-11-16).
            graceWindow: 0.25,
            // No floor either (like shop gear): copies come from boxes we hold in numbers.
            free: ["helmet1", "gloves1", "pants1", "coat1", "shoes1"],
            maxScrollGrade: 2,     // try up to Rare scrolls when the normal one falls short
            buyStrongerScrolls: true, // only within budgetPerWish; owned/banked ones are used first
        },
        // Gold per wish (base item + scrolls, failures included): shop gear vs token/drop
        // items (player decision 2026-11-16: room for Rare scrolls, 1.6M each).
        budgetPerWish: { shop: 1000000, rare: 4000000 },
        massSkills: true,             // Mass Production / Mass Exchange before upgrades and exchanges
        mainStatOnArmor: true,        // wished armor always gets the class's main stat scroll
        deliveryBatchMs: 10 * 60 * 1000, // finish the open wishes first; a ready item waits at most this long
        giveUpForMs: 60 * 60 * 1000,  // after a stop (risk/no source/wish budget used up) retry in an hour
        retryAfterBudgetMs: 10 * 60 * 1000, // ...but only 10 min when we merely lack gold right now
        bankScanEveryMs: 10 * 60 * 1000,
        redeliverAfterMs: 6 * 60 * 60 * 1000, // don't fulfil the same wish for a fighter again within 6 h
        // Grace farming (approved 2026-11-15): before a compound/rare item is risked at a
        // level whose chance is too low, cheap shop items are failed at that level to raise
        // the player's grace for it. The real preview decides when it is enough.
        grace: {
            enabled: true,
            minLevel: 4,             // only for steps to +4 and higher
            fodder: "wbasher",       // cheap upgradeable shop item no gear goal uses (Wooden Basher, 4,900 gold)
            // Gold per target level per 24 h (fodder + scrolls): incomeShare of the merchant's
            // net income over 24 h (player decision 2026-11-16; ~15M/day -> ~750k), at least
            // budgetPerLevel.
            incomeShare: 0.05,
            budgetPerLevel: 300000,
            // Player decision 2026-11-16: +5M per level until the gear goal extra ends.
            extra: { amount: 5000000, until: "2026-11-17T06:15:44Z" },
            maxAttempts: 25,         // fodder attempts per farming round
            // Grace stacks only while the fodder itself would fail more likely than not: stop
            // when its own chance at the target level is above this - now, or by the time the
            // stacks still needed are built (measured gain per stack). A success resets them.
            maxFodderChance: 0.5,
            batch: 5,                // helmets prepared at once, then attempted back to back
        },
        // Spare copies to upgrade when idle (approved 2026-11-15): Phoenix weapons are kept
        // as spares; the best copy below upTo is upgraded, failures use up surplus copies,
        // never going below `spares` copies in total. Normal scrolls only: rare scrolls
        // and grace farming are reserved for the fighters' wishes.
        stockEnabled: false, // paused 2026-11-16 (shop +9 first)
        // Weapon ladder (player decision 2026-11-16): grace can't lift high-grade items, so
        // spare copies of these are upgraded at once with the normal scroll - always to one
        // level above the WEAKEST worn copy in the team (both of the warrior's fireblades
        // count). A spare that gets there is swapped in, the old one becomes the next spare;
        // the next level starts only once every worn copy is at the top. Worn copies are never
        // risked; items nobody wears are left alone.
        // hoardAt (2026-11-16): spares are not risked beyond this level; +7 copies are kept.
        bruteForce: { names: ["fireblade", "firebow", "firestaff"], maxLevel: 9, hoardAt: 7 },
        // Box armor (player decision 2026-11-17): while a fighter wishes any Rugged piece,
        // every spare copy from the armor boxes is upgraded towards upTo at once – failures
        // free bank slots and the next chain pieces are ready early (the bank has ~19 free
        // slots; a new pack costs 75M).
        boxArmor: { names: ["helmet1", "gloves1", "pants1", "coat1", "shoes1"], upTo: 7 },
        stock: [
            { name: "fireblade", upTo: 7, spares: 3 },
            { name: "firestaff", upTo: 7, spares: 3 },
        ],
        // Drop weapons (player decision 2026-11-15): a Phoenix weapon we hold that beats a
        // fighter's worn weapon goes to that fighter; if none does yet, the best copy is
        // upgraded to the first level that would (at most maxLevel). A failure only costs
        // a drop – the fighter keeps its shop weapon. Gear-goal budget, normal scrolls.
        betterWeapons: {
            enabled: true,
            names: ["fireblade", "firestaff", "firebow", "concordmace", "maceofthedead", "staffofthedead", "bowofthedead"],
            maxLevel: 7,
            margin: 0.03,   // at least 3% stronger than the worn weapon
            // Next weapon step (player decision 2026-11-16): once a fighter's weapon (shop or
            // fire) is at gearGoals.upTo, its "of the Dead" weapon is crafted (Bones from
            // Zombies + a shop weapon + fee) and upgraded until it is stronger.
            craft: ["maceofthedead", "staffofthedead", "bowofthedead"],
            // Bought with tokens when we hold none (player decision 2026-11-16: the Concord
            // Mace first – a paladin's mace beats the fireblade +7 already at +4).
            buy: [], // concordmace paused 2026-11-16 (no paladin; shop +9 first)
            // Token weapons are not cheap to lose: each step needs this chance.
            minChance: { concordmace: 0.5 },   // = risk.rare
        },
        // Gear goals (approved 2026-11-15): when idle, the merchant pushes the fighters' worn
        // shop armor and selected weapons to `upTo`. Shop armor is re-buyable, so every
        // attempt is made whatever its chance: a failure only costs gold and raises the
        // grace for that level (for every item), a success is a finished piece. The finished
        // copy gets the fighter's stat scroll (str/int/dex) and is delivered; the fighter's
        // guide equips it and the old piece comes back as a base for the next copy.
        // Weapons are not re-buyable: only a spare copy one level below `upTo` is risked,
        // and only once grace has raised its chance to `minChance`.
        // The workshop (wishes, gear goals, grace) never spends below this (player
        // decision 2026-11-16, together with the income-based gear-goal budget).
        keepGold: 5000000,
        gearGoals: {
            enabled: true,
            // Since 2026-11-15 (player request): don't let armor and weapons wait while the guide
            // works on accessories – worn shop armor and shop weapons go to +7 (the end of the
            // guide's lessons) in parallel, with the class's main stat. Weapons come first,
            // armor follows once no weapon step is open (player request 2026-11-15).
            fromLevel: 0,
            upTo: 7,                  // weapons and the "shop gear done" mark for class wishes
            // Armor in stages (player decision 2026-11-16): ALL of a fighter's shop armor
            // reaches a stage before any piece goes on to the next. From +7 each level adds
            // +3 main stat. Guide estimate per piece from scratch: +8 ~170 copies / 1.1M,
            // +9 ~2400 copies / 17M, +10 ~100,000 copies / 770M. Capped at +8 (player
            // decision 2026-11-16: 170 -> 2400 copies is too steep; armor boxes / Rugged next).
            stages: [7, 8],
            everyMs: 3 * 60 * 1000,   // one gear-goal step this often even while wishes are open
            slots: ["helmet", "chest", "pants", "shoes", "gloves", "mainhand"],
            weapons: [], // fire weapons: workshop.bruteForce (weapon ladder) since 2026-11-16
            // Daily budget from income (player decision 2026-11-15): a share of the merchant's
            // net gold gain over the last 24 h; the gear goals' own spending is not counted
            // as a loss. Gold moved by hand (a jump of transferAbove or more within 10 min)
            // is not income. No fixed total since 2026-11-16 (player decision): long-term
            // positive cash flow, with workshop.keepGold as the floor. `total` (optional)
            // would cap everything ever spent on gear goals.
            budget: {
                incomeShare: 0.5, transferAbove: 3000000,
                // Player decision 2026-11-17: 10M more to spend until 09:00 German time. The extra
                // counts against the last 24 h of spending (16M by then), so 15M leaves ~10M free.
                extra: { amount: 15000000, until: "2026-11-17T08:00:00Z" },
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
            batch: 10,     // exchanges per round, so deliveries are not delayed for long
            keepFree: 8,   // stop while fewer bag slots are free (rewards need room)
        },
    },

    // Merchant role
    merchantRole: {
        // Potion stock: potions.target per fighter using a size (at most stockPerPotion),
        // only built while we have stockFromGold – below that, gold goes to equipment
        // first and deliveries buy just what is needed.
        stockPerPotion: 1000,
        stockFromGold: 100000,
        goldReserve: { ratio: 0.2, min: 0, max: 1000000 }, // never spend below 20% of our gold (max 1M)
        handoverWaitMs: 10000,               // wait next to the fighter for its loot
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
        // Phoenix and event weapons are never on this list – they can't be bought again.
        sellList: [
            // junk drops. Craft ingredients (spores, crab claws, frog tongues, ascale,
            // bear fur, white eggs, carrots, vit scrolls) are kept since the
            // fresh start (2026-11-15): Cole and Leo craft gear from them.
            "slimestaff", "mushroomstaff", "stinger",
            "wcap", "wshoes", "wattire", "wbreeches", "wgloves",
            // +0 weapons (approved 2026-11-15). Phoenix weapons (fireblade, firestaff,
            // firebow) are never sold – player decision 2026-11-15.
            "dagger",
            "snowball",
            // V1 upgraded short swords to +4 – no longer needed (approved 2026-11-15)
            { name: "sword", maxLevel: 4 },
            // the Paladin's old starter gear (approved 2026-11-15).
            // Accessories (rings, belts, amulets, earrings) and books are NOT sold:
            // they are compound/upgrade material the progression guide asks for –
            // except the HP/VIT ones no class or guide wants (approved 2026-11-16; any
            // level: compounding them first loses gold on average). Worn copies stay.
            { name: "hpamulet", maxLevel: 10 },
            { name: "vitearring", maxLevel: 10 },
            { name: "vitring", maxLevel: 10 },  // STR beats VIT for the warrior too (player decision 2026-11-16)
            { name: "hpbelt", maxLevel: 10 },   // kept while a tank's HP-belt wish is open (isReserved)
            { name: "helmet", maxLevel: 3 },
            // Shop weapons and the old quiver that did their job (player decision 2026-11-16):
            // fire weapons replaced them, the ranger wears a quiver +8. A copy a fighter or
            // its guide wishes for is never sold (isReserved).
            { name: "mace", maxLevel: 7 },
            { name: "staff", maxLevel: 7 },
            { name: "blade", maxLevel: 5 },
            { name: "quiver", maxLevel: 2 },
            // Lollipop Maces from the archive (player decision 2026-11-16): weak tier-0 maces.
            { name: "glolipop", maxLevel: 10 },
            // Materials without a plan (player decision 2026-11-16). Kept on purpose: green
            // slime, ashleaf (Thistle Quiver), bat wings, spores (Oathplate), reef glass,
            // carrots (Carrot Sword).
            "snakefang", "embercoal", "rattail", "smush",
            // Rugged and Heavy armor (armor boxes) are no longer sold since the fresh start:
            // craft bases (Oathplate, Resolute Sallet, class boots) and upgrades (2026-11-16).
        ],
        // Items the merchant hands to a fighter on its next delivery (one-off gifts).
        give: {
        },
        // Every fighter gets one of these if it carries none; the merchant keeps one too.
        // Tracktrix: monster achievement bonuses only apply while it is carried.
        onePerCharacter: ["tracker"],
        // Skill ingredients go to the class that uses them on every delivery.
        classItems: { priest: ["essenceoflife"], ranger: ["poison"] },
        // Bank: when the bag runs low on space, everything that is neither sold
        // nor kept below goes into the bank (auto placement, stacks merge).
        // New bank packs are never bought automatically.
        bank: {
            whenFreeBelow: 6,
            keep: [
                "tracker",
                "scroll0", "scroll1", "scroll2", "cscroll0", "cscroll1", "cscroll2",
                "essenceoflife", "poison", // skill ingredients for priests / rangers
            ],
        },
    },
};
