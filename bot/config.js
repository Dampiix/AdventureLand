// =====================================================================
// bot_config – everything you are expected to tweak lives here.
// Characters are identified by name; roles are explicit (no list-order
// magic like V1's party_list[3]). Classes come from character.ctype.
// =====================================================================

module.exports = {
    version: "1.0.1",

    // The character you play in the client. Its CODE starts the others.
    leader: "DmpxPalTank",

    // "solo": leader farms alone (Lone Wolf bonus), merchant supports it.
    // "party": the whole team runs (party logic follows in v2).
    phase: "solo",
    phases: {
        solo: { startWithLeader: ["DampiixMerch"] },
        party: { startWithLeader: ["Dampiix", "DampiixPri", "DampiixMerch"] },
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

    targeting: {
        farm: null,               // e.g. "squigtoad" to force a monster for everyone
        fallback: "goo",          // used when the progression guide has no answer
        refreshMs: 5 * 60 * 1000, // how often to ask the guide again
    },

    combat: {
        potionHpBelow: 0.45,
        potionMpBelow: 0.3,
    },

    classes: {
        paladin: { selfHealBelow: 0.6, useSmash: true, mpReserve: 150 },
        priest: { healBelow: 0.75, selfHealBelow: 0.6 },
        mage: {},
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
        keep: ["tracker"],               // never handed to the merchant
        goldKeep: 200000,                // fighters keep this much gold
        goldMinSend: 50000,              // only send gold when the surplus is at least this
        freeSlotsMin: 6,                 // ask for a pickup when fewer slots are free
        pickupEveryMs: 15 * 60 * 1000,   // ask for a routine pickup this often
        requestEveryMs: 60 * 1000,       // don't spam the merchant
        merchantTimeoutMs: 3 * 60 * 1000 // no answer for this long -> buy potions yourself
    },

    // Merchant role
    merchantRole: {
        stock: { hpot1: 1000, mpot1: 1000 }, // potions kept in stock for deliveries
        goldReserve: 1000000,                // never spend below this
        handoverWaitMs: 10000,               // wait next to the fighter for its loot
        // Items the merchant sells to NPCs. REVIEW THIS LIST.
        // Upgraded (+1 and higher), shiny and locked items are never sold.
        sellList: [
            "whiteegg", "spores", "slimestaff", "mushroomstaff", "stinger",
            "wcap", "wshoes", "wattire", "wbreeches", "wgloves",
            "vitearring", "vitring", "vitscroll",
        ],
    },
};
