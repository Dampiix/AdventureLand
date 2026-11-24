// Defaults of supply/ and the elixir rules (stage 7b): config.js fills these in where it has no value of its own (ours
// always win). Which items we keep, which elixir each class drinks and the elixirs we buy stay in config.js.
module.exports = {
    // Fighter side of the item/gold flow
    supply: {
        goldKeep: 10000,                 // emergency fund for potions; the rest goes to the merchant
        goldMinSend: 5000,               // only send gold when the surplus is at least this
        freeSlotsMin: 6,                 // ask for a pickup when fewer slots are free
        pickupEveryMs: 20 * 60 * 1000,   // ask for a routine pickup this often
        firstPickupAfterMs: 60 * 1000,   // first routine pickup this long after the bot starts
        requestEveryMs: 60 * 1000,       // don't spam the merchant
        merchantTimeoutMs: 3 * 60 * 1000, // no answer for this long -> buy potions yourself
        // While the merchant is on its way we keep farming and send our position this often, for at most followMs.
        positionEveryMs: 5000,
        followMs: 5 * 60 * 1000,
    },

    // Elixirs: a fighter carries `carry` and drinks one when none works or its own runs out within drinkBeforeMs.
    // Merchant: exchange - Seashells while a stat elixir is below min, until all are at refill (sourceKeep shells stay).
    elixirs: {
        enabled: true,
        carry: 4,                           // per fighter in the bag: 2 days
        drinkBeforeMs: 10 * 60 * 1000,
        callEveryMs: 5 * 60 * 1000,         // fewer than carry/2 in the bag calls the merchant, at most this long after its last visit
        exchange: { source: "seashell", min: 6, refill: 20, sourceKeep: 40 },
    },
};
