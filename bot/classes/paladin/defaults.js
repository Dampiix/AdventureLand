// Defaults of classes/paladin/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
// Paladin (classes/paladin/): mana-shield, oath, cleansing modules; self-heal and Smash in the class.
module.exports = {
    classes: {
        paladin: {
            selfHealBelow: 0.6,
            useSmash: true, mpReserve: 150, // Smash needs a mace
            oathBelow: 0.5,                 // Guardian's Oath on allies below 50% HP (lvl 50+)
            useCleansingLight: true,        // lift poison/curse/burn/... from allies (lvl 30+)
            // Mana Shield: damage drains MP instead of HP while on
            manaShield: { onBelow: 0.35, offAbove: 0.7, minMp: 0.25 },
        },
    },
};
