// Defaults of gear/ (stage 7b): config.js fills these in where it has no value of its own (ours always win). Items we
// never equip, minimum levels and worn limits stay in config.js.
module.exports = {
    // Fighters: equipment wishes from the progression guide + auto-equip
    gear: {
        enabled: true,
        wishEveryMs: 5 * 60 * 1000, // re-read the guide and resend wishes this often
        maxWishes: 12,  // class chains alone are up to 9; a longer list shifts less (the merchant works through it one by one)
        // Class wishes for slots the guide leaves empty: the chains of gearPlan.wishes (only the first step not reached).
        classWishesEnabled: true,
        classWishes: {}, // fixed wishes per class ("all" for every class): { warrior: [{ name, level }] } - none set now
    },
};
