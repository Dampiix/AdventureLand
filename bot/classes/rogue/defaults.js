// Defaults of classes/rogue/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
// Rogue (classes/rogue/): swiftness, stealth, fanofknives, strikes modules; Quick Stab/Punch follow the mainhand.
module.exports = {
    classes: {
        rogue: {
            mpReserveRatio: 0.25,
            swiftness: true,          // Rogue Swiftness (lvl 40) on us and party members in reach
            smokeBelow: 0.25,         // Assassin's Smoke below this HP share with monsters on us (0 = never) ...
            smokeUntil: 0.6, smokeClear: 200, // ... then hide where no monster is within smokeClear px until this HP share
            mentalBurst: true,        // only once INT reaches the skill's 64
            fanFrom: 3,               // Fan of Knives (lvl 65, Knife Belt) with this many monsters around
            poisonCoat: { enabled: true, minHits: 40 }, // A Poisonous Touch (Poison Sack) on targets needing 40+ hits
        },
    },
};
