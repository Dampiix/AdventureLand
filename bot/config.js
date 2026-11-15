// =====================================================================
// bot_config – everything you are expected to tweak lives here.
// Characters are identified by name; roles are explicit (no list-order
// magic like V1's party_list[3]). Classes come from character.ctype.
// =====================================================================

module.exports = {
    version: "1.6.3",

    // The character you play in the client. Its CODE starts the others
    // and it is the party leader / tank.
    leader: "DmpxPalTank",

    // "solo":  leader farms alone (Lone Wolf bonus), merchant supports it.
    // "party": leader + mage + priest farm together, merchant supports them.
    // startWithLeader: characters the leader starts in the same client.
    // party:           fighters that form the party (leader included).
    phase: "party",
    phases: {
        solo: { startWithLeader: ["DampiixMerch"], party: [] },
        party: {
            startWithLeader: ["Dampiix", "DampiixPri", "DampiixMerch"],
            party: ["DmpxPalTank", "Dampiix", "DampiixPri"],
        },
    },

    party: {
        followDistance: 80,   // members idle within this distance of the leader
        leash: 300,           // members drop everything and catch up beyond this
        broadcastMs: 2000,    // leader shares position/target this often
        inviteEveryMs: 10000, // leader re-invites a missing member this often
    },

    // Only these characters are trusted for CODE messages.
    // Optional per-character "farm" overrides the target choice.
    characters: {
        DmpxPalTank: { role: "fighter" },
        Dampiix: { role: "fighter" },
        DampiixPri: { role: "fighter" },
        DampiixMerch: { role: "merchant" },
    },
    merchant: "DampiixMerch",

    tickMs: 250,

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
        search: ["phoenix"],            // roaming bosses the leader looks for
        searchEveryMs: 10 * 60 * 1000,  // search again this long after a miss or a kill
        searchSpotMs: 4000,             // look around this long at each spawn area
    },

    // Monster Hunts (Daisy). Unsafe hunts are left to expire.
    hunts: {
        enabled: true,
        allow: [],                       // always hunt these, even if the guide calls them unsafe
        deny: [],                        // never hunt these
        minRemainingMs: 2 * 60 * 1000,   // skip hunts about to expire
        visitCooldownMs: 10 * 60 * 1000, // at most one Daisy trip per 10 min
        waitAtDaisyMs: 6000,             // leader waits so members can talk to Daisy too
        daisyRange: 200,                 // how close counts as standing at Daisy
        shareMs: 10000,                  // members report their hunt to the leader this often
    },

    targeting: {
        farm: null,              // e.g. "squigtoad" to force a monster for everyone (null = guide)
        fallback: "goo",          // used when the progression guide has no answer
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
        mage: {
            energizeAbove: 0.6,             // only give mana while we have more than this
            energizeBelow: 0.4,             // to a member below this MP ratio
            useBurst: false,                // Mana Burst empties the whole MP pool
        },
    },

    potions: {
        hp: "hpot1",
        mp: "mpot1",
        target: 300,       // fighters get topped up to this many of each
        requestBelow: 100, // ask the merchant for more below this
        selfBuyBelow: 20,  // walk to town and buy yourself below this (merchant missing)
    },

    // Fighter side of the item/gold flow
    supply: {
        keep: ["tracker", "glolipop"],   // never handed to the merchant
        goldKeep: 200000,                // fighters keep this much gold
        goldMinSend: 50000,              // only send gold when the surplus is at least this
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
        minChance: 0.7,               // never attempt an upgrade step below 70%
        budgetPerWish: 500000,        // gold per wish (base item + scrolls, failures included)
        giveUpForMs: 60 * 60 * 1000,  // after a stop (risk/budget/no source) retry in an hour
        bankScanEveryMs: 10 * 60 * 1000,
        compound: {
            auto: true,   // combine spare accessories/books when no wish is open
            autoUpTo: 3,  // ...up to this level (each step still needs >= minChance)
        },
        // Exchange (approved 2026-11-15: everything except seasonal items).
        exchange: {
            enabled: true,
            items: ["armorbox", "gem0", "gem1", "seashell"],
            batch: 10,     // exchanges per round, so deliveries are not delayed for long
            keepFree: 8,   // stop while fewer bag slots are free (rewards need room)
        },
    },

    // Merchant role
    merchantRole: {
        stock: { hpot1: 1000, mpot1: 1000 }, // potions kept in stock for deliveries
        goldReserve: 1000000,                // never spend below this
        handoverWaitMs: 10000,               // wait next to the fighter for its loot
        // Items the merchant sells to NPCs.
        // A plain name sells only +0 copies. { name, maxLevel } also sells
        // upgraded copies up to that level. Shiny and locked items are never sold.
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
        ],
        // Items the merchant hands to a fighter on its next delivery (one-off gifts).
        give: {
            DmpxPalTank: ["glolipop"], // Lolipop Mace – lets the Paladin use Smash
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
