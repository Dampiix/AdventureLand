// Defaults of classes/mage/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
// Mage (classes/mage/): skill thresholds and timings. Details: the module headers.
module.exports = {
    classes: {
        mage: {
            // Energize: MP to a member below energizeBelow while we keep energizeAbove; else a speed burst on the strongest
            // fighter (ourselves within burstLeadMs ms of our next attack). energize: false = off.
            energizeAbove: 0.6, energizeBelow: 0.4, burstLeadMs: 250,
            // Reflective Shield on whoever takes the most magical attack (at least reflectMinAttack), keeping reflectKeepMp
            // of our MP. reflect: false = off.
            reflectMinAttack: 100, reflectKeepMp: 0.25,
            useBurst: false, // Mana Burst: empties the whole MP pool
            // Blaster mode: on for a pack (minNeighbours in its blast radius) above minMp, or always when it beats staff + book
            // by singleMargin (singleTarget); back after keepMs without a pack or below offMp. aim: shoot the same kind's best
            // pack. blockMs: staff + book after a held unsafe blast. fearMax: a blast may pull courage + this many.
            blaster: { enabled: true, minNeighbours: 2, minMp: 0.5, offMp: 0.2, keepMs: 4000, holdMs: 60000,
                singleTarget: true, singleMargin: 0.03, aim: true, blockMs: 6000, fearMax: 0 },
            // Team Magiport at the team goal: pulls fighters farther than minDist px (tank first) while keepMp stays; a boss
            // goal counts once it is in sight within bossRange px for graceMs; tries per member and goal, retryMs apart.
            // events.js reads enabled for the members' consent.
            magiport: { enabled: true, keepMp: 0.3, minDist: 600, bossRange: 800, graceMs: 4000, tries: 3, retryMs: 8000 },
            // Blink on routes: jump to the farthest step on this map at least minDist px away, keeping keepMp of our MP.
            blinkTravel: { enabled: true, minDist: 400, keepMp: 0.4 },
        },
    },
};
