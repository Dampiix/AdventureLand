// =====================================================================
// bot_config – everything you are expected to tweak lives here.
//
// To run a different team (e.g. brand-new level-1 characters) only the
// `team` block needs to change. Classes come from character.ctype, so any
// class works; paladin, priest, mage and ranger have skill modules.
// =====================================================================

module.exports = {
    version: "1.16.1",

    team: {
        // Fresh save (2026-11-15). The old characters DampiixWar, Dampiix, DampiixPri and
        // Dampiiix are an item archive: never list them here, the bot would hand their
        // items to the merchant.
        leader: "DmpxPala",                             // played in the client, starts the others, tanks
        fighters: ["DmpxPala", "DmpxPriest", "DmpxRanger"],
        merchant: "DampiixMerch",                       // null for no merchant
        farm: {},                                       // optional per-character farm override, e.g. { DmpxRanger: "bee" }
    },

    // "solo":  only the leader fights (Lone Wolf bonus); the merchant still supports it.
    // "party": all fighters form a party around the leader.
    phase: "party",

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
    },

    // Events and world bosses (approved 2026-11-15). "always" or "never" (default).
    events: {
        enabled: true,
        observe: true,                  // log which events are live and what we do
        policy: {
            snowman: "always",          // holiday season world boss, 1,200 HP
            goobrawl: "always",         // daily goo fight
            phoenix: "always",          // roaming coop boss, weak hits, 180k XP, fire weapons
            crabxx: "never", franky: "never", icegolem: "never",
            horseman: "never", graveyard: "never", abtesting: "never",
        },
        // "always" only applies once every fighter has reached this level
        minLevel: { phoenix: 40, goobrawl: 20, snowman: 10 },
        search: ["phoenix"],            // roaming bosses the leader looks for
        searchEveryMs: 10 * 60 * 1000,  // search again this long after a miss or a kill
        searchSpotMs: 4000,             // look around this long at each spawn area
    },

    // Monster Hunts (Daisy). Unsafe hunts are left to expire.
    hunts: {
        enabled: true,
        minLevel: 20,                    // only once every fighter has this level (Daisy ignores our level)
        allow: [],                       // always hunt these, even if the guide calls them unsafe
        deny: [],                        // never hunt these
        minRemainingMs: 2 * 60 * 1000,   // skip hunts about to expire
        visitCooldownMs: 10 * 60 * 1000, // at most one Daisy trip per 10 min
        waitAtDaisyMs: 6000,             // leader waits so members can talk to Daisy too
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
        want: [],
    },

    targeting: {
        farm: null,              // e.g. "squigtoad" to force a monster for everyone (null = guide)
        fallback: "goo",          // used when the progression guide has no answer
        // Farm only where every fighter's own guide calls the spot safe; routes the guide
        // only offers as a careful trial count once proven – by the guide's own fights, or
        // by 15 min of team farming there without a death (remembered across restarts).
        avoidTrial: true,
        refreshMs: 5 * 60 * 1000, // how often to ask the guide again
        crowdedAfterMs: 90 * 1000,    // no free target this long on the farm map -> spot is crowded
        crowdedForMs: 5 * 60 * 1000,  // then use the guide's next choice for this long
    },

    combat: {
        potionHpBelow: 0.45,
        potionMpBelow: 0.3,
    },

    classes: {
        paladin: {
            selfHealBelow: 0.6,
            useSmash: true, mpReserve: 150, // Smash needs a mace
            oathBelow: 0.5,                 // Guardian's Oath on allies below 50% HP (lvl 50+)
        },
        priest: {
            healBelow: 0.75, selfHealBelow: 0.6,
            partyHealBelow: 0.65,           // Party Heal when 2+ members are below this...
            partyHealDanger: 0.35,          // ...or one member is below this
            useCurse: true, mpReserveRatio: 0.4,
        },
        ranger: {
            sturdyHits: 3,                  // Hunter's Mark / Supershot only on targets needing 3+ hits
            mpReserveRatio: 0.3,
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
        keep: ["tracker", "glolipop"],   // never handed to the merchant
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
        maxWishes: 3,
    },

    // Merchant: fulfil wishes from bag, bank or by upgrading own copies (approved 2026-11-15)
    workshop: {
        enabled: true,
        // Minimum success chance per step, by what is at risk (approved 2026-11-15):
        risk: {
            cheapBelow: 100000,    // value of the copy (x3 for compounds) below this is "cheap"
            midBelow: 1000000,     // ...below this "mid"; above, or not re-buyable from an NPC: "precious"
            cheap: 0.4,
            mid: 0.6,
            precious: 0.7,
            maxScrollGrade: 2,     // try up to Rare scrolls when the normal one falls short
            buyStrongerScrolls: true, // only within budgetPerWish; owned/banked ones are used first
        },
        budgetPerWish: 500000,        // gold per wish (base item + scrolls, failures included)
        giveUpForMs: 60 * 60 * 1000,  // after a stop (risk/no source/wish budget used up) retry in an hour
        retryAfterBudgetMs: 10 * 60 * 1000, // ...but only 10 min when we merely lack gold right now
        bankScanEveryMs: 10 * 60 * 1000,
        redeliverAfterMs: 6 * 60 * 60 * 1000, // don't fulfil the same wish for a fighter again within 6 h
        // Grace farming (approved 2026-11-15): before a mid/precious item is risked at a
        // level whose chance is too low, cheap shop items are failed at that level to raise
        // the player's grace for it. The real preview decides when it is enough.
        grace: {
            enabled: true,
            minLevel: 4,             // only for steps to +4 and higher
            fodder: "mace",          // cheap upgradeable shop item no gear goal uses (3,700 gold)
            budgetPerLevel: 300000,  // gold per target level per 24 h (fodder + scrolls)
            maxAttempts: 25,         // fodder attempts per farming round
            batch: 5,                // helmets prepared at once, then attempted back to back
        },
        // Spare copies to upgrade when idle (approved 2026-11-15): Phoenix weapons are kept
        // as spares; the best copy below upTo is upgraded, failures use up surplus copies,
        // never going below `spares` copies in total. Normal scrolls only: rare scrolls
        // and grace farming are reserved for the fighters' wishes.
        stock: [
            { name: "fireblade", upTo: 7, spares: 3 },
            { name: "firestaff", upTo: 7, spares: 3 },
        ],
        // Gear goals (approved 2026-11-15): when idle, the merchant pushes the fighters' worn
        // shop armor and selected weapons to `upTo`. Shop armor is re-buyable, so every
        // attempt is made whatever its chance: a failure only costs gold and raises the
        // grace for that level (for every item), a success is a finished piece. The finished
        // copy gets the fighter's stat scroll (str/int/dex) and is delivered; the fighter's
        // guide equips it and the old piece comes back as a base for the next copy.
        // Weapons are not re-buyable: only a spare copy one level below `upTo` is risked,
        // and only once grace has raised its chance to `minChance`.
        gearGoals: {
            enabled: true,
            fromLevel: 7,  // only pieces worn at +7 or more: below, the guide's lessons decide
            upTo: 8,
            slots: ["helmet", "pants", "shoes", "gloves"], // coats are +8 already; +9 costs far more
            weapons: [{ name: "fireblade", minChance: 0.18 }], // 14% at +8, ~19% with full grace
            // Daily budget from income (player decision 2026-11-15): a share of the merchant's
            // net gold gain over the last 24 h; the gear goals' own spending is not counted
            // as a loss. `total` caps everything ever spent on gear goals.
            budget: { incomeShare: 0.5, total: 5000000 },
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
            items: ["gem0", "gem1", "seashell"], // armor boxes stopped 2026-11-15 (their rewards only filled the bank)
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
            // junk drops
            "whiteegg", "spores", "slimestaff", "mushroomstaff", "stinger",
            "wcap", "wshoes", "wattire", "wbreeches", "wgloves", "vitscroll",
            // +0 weapons (approved 2026-11-15). Phoenix weapons (fireblade, firestaff,
            // firebow) are never sold – player decision 2026-11-15.
            "dagger",
            // cheap materials (approved 2026-11-15)
            "bfur", "frogt", "crabclaw", "ascale", "carrot", "snowball",
            // V1 upgraded short swords to +4 – no longer needed (approved 2026-11-15)
            { name: "sword", maxLevel: 4 },
            // the Paladin's old starter gear (approved 2026-11-15).
            // Accessories (rings, belts, amulets, earrings) and books are NOT sold:
            // they are compound/upgrade material the progression guide asks for.
            { name: "helmet", maxLevel: 3 },
            { name: "mace", maxLevel: 2 },
            // armor box rewards: tier-1 and heavy armor at +0 – useless for a level-60 team
            // (approved 2026-11-15; X-armor, Fury and Starkillers are kept)
            "coat1", "helmet1", "pants1", "gloves1", "shoes1",
            "hhelmet", "harmor", "hpants", "hgloves", "hboots",
            // rat tails: every recipe needs 30+ – we have 5
            "rattail",
        ],
        // Items the merchant hands to a fighter on its next delivery (one-off gifts).
        give: {
        },
        // Bank: when the bag runs low on space, everything that is neither sold
        // nor kept below goes into the bank (auto placement, stacks merge).
        // New bank packs are never bought automatically.
        bank: {
            whenFreeBelow: 6,
            keep: [
                "tracker", "glolipop",
                "scroll0", "scroll1", "scroll2", "cscroll0", "cscroll1", "cscroll2",
            ],
        },
    },
};
