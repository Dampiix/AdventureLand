// Defaults of classes/ranger/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
// Ranger (classes/ranger/): three-shot and sturdy-shots modules.
module.exports = {
    classes: {
        ranger: {
            sturdyHits: 3,                  // Hunter's Mark / Supershot only on targets needing 3+ hits
            mpReserveRatio: 0.3,
            usePoisonArrow: true,           // consumes a Poison Sack
        },
    },
};
