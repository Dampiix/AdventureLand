// Defaults of classes/priest/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
// Priest (classes/priest/): skill thresholds and timings. Details: the module headers.
module.exports = {
    classes: {
        priest: {
            healBelow: 0.75, selfHealBelow: 0.6,   // heal a member below / ourselves below this HP ratio
            // Party Heal: 2+ members below partyHealBelow, or one below partyHealDanger, or any (also out of sight) below partyHealOne.
            partyHealBelow: 0.65, partyHealDanger: 0.35, partyHealOne: 0.5,
            useCurse: true, mpReserveRatio: 0.4,   // Curse on sturdy targets; Curse and Dark Blessing keep this MP share
            useRevive: true,                       // revive fallen members (consumes an Essence of Life)
            // Absorb Sins as an emergency: a non-tank member below `below` with monsters on it and no tank in Taunt range,
            // while we are above selfAbove.
            absorb: { enabled: true, below: 0.35, selfAbove: 0.6 },
            // Luck catch: Absorb Sins on an ally whose monster dies within `hits` hits (at most maxPull, we above minHp, once per
            // everyMs per ally); without a tank within tankRange only what our courage holds. Summary every logEveryMs.
            luckCatch: { enabled: true, hits: 2, maxPull: 5, minHp: 0.6, everyMs: 1500, tankRange: 400, logEveryMs: 10 * 60 * 1000 },
            // Luck swap (gear/): these pieces go on with the luck catch and come off backMs after the last one; missing
            // pieces are skipped, a piece listed twice fills both slots (two Clover Studs).
            luckSwap: { enabled: true, backMs: 3000 },
            // Dark Blessing (level 70): +25 % party damage for 8 s on targets needing sturdyHits+ of our hits, and on bosses.
            darkBlessing: { enabled: true, sturdyHits: 10 },
        },
    },
};
