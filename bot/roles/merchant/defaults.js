// Defaults of roles/merchant/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
// The merchant's own wishes, the stand's home, the sell list, gifts, the Ponty servers, class items and the bank's keep
// list stay in config.js.
module.exports = {
    merchantRole: {
        gather: {
            // One catch per 48 min, 99.5% a Rugged piece.
            fishing: { enabled: true, maxCasts: 40 },
        },
        stand: {
            enabled: true,
            reach: 390,               // NPCs this close are used without walking (server: 400)
        },
        // Potion stock: potions.target per fighter (at most stockPerPotion), built only while we have stockFromGold gold.
        stockPerPotion: 1000,
        stockFromGold: 100000,
        handoverWaitMs: 10000,               // wait next to the fighter for its loot
        // A pickup follows the fighter and re-routes once it moved more than retargetPx; gives up after followMs.
        followMs: 4 * 60 * 1000,
        retargetPx: 150,
        // NPC sales (never shiny, locked, worn or wished copies); sellBuyable: NPC-shop items go at +0, except these types.
        sellBuyable: {
            enabled: true,
            maxLevel: 0,
            exceptTypes: ["pot", "uscroll", "cscroll", "pscroll", "offering", "stand", "elixir", "booster", "tome", "qubics"],
        },
        // Merchant's Luck on ourselves, our fighters and (strangers) every other non-merchant player in reach; ours is
        // renewed below refreshBelowMs, strangers' strong mluck is left alone.
        mluck: { enabled: true, strangers: true, refreshBelowMs: 30 * 60 * 1000, mpReserve: 100 },
        pontyRound: { prepMaxMs: 8 * 60 * 1000, hopTimeoutMs: 2 * 60 * 1000 },
        // Workshop rhythm: after a round that did something the next one comes after this; a round that only found locked
        // jobs tries the next at once; 30 s only when there is nothing to do.
        workshopFastMs: 3000,
        // Bank: with few free bag slots, everything neither sold nor kept goes into the bank (no new bank packs bought).
        bank: {
            whenFreeBelow: 6,
            // Below this many free bag slots the workshop's idle stock is banked as well (taken out again when needed).
            stockFreeBelow: 15,
            // Before each pickup: bank first while fewer slots are free (store only, workshop copies too). 0 = off.
            beforePickupFree: 12,
        },
    },
};
