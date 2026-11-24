// Defaults of safety/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
module.exports = {
    targeting: {
        // Team model: safe when the tank survives tankHits volleys of `pull` monsters (pullAggressive: aggressive ones),
        // healing covers that x healCover and the others survive otherHits hits. "/safety [map]" logs the verdicts.
        teamSafety: {
            enabled: true,
            tankClasses: ["warrior", "paladin"],
            tankHits: 6, otherHits: 3, healCover: 1.5,
            pull: 2, pullAggressive: 3,
            pullPassive: 1,                // aggro and rage below isolation.minAggro/minRage: one at a time
            pullLone: 2,                   // monsters pulled one at a time (isolation): one plus a possible add
            denseArea: 15000,              // aggressive spawns with less area per monster (px²) come as a whole pack
            abilities: [],                 // monster abilities we accept (others: the guide decides)
            fightHpUse: 0.5,               // uncovered damage over the whole fight: at most this share of the tank's max HP
        },
        // Aggro/rage monsters are pulled only with no other free one within radius px of the target or the way there.
        // strongHold / watchMargin: px to stop from too-strong ones / to wait outside the spawn box for a lone one.
        // packOf: how many we must take at once (null: the team model's pullAggressive, else 3).
        isolation: { enabled: true, minAggro: 0.3, minRage: 0.3, radius: 120, strongHold: 300, watchMargin: 150, packOf: null },
        // Solo: our own check of a guide route (false switches it off).
        soloOwnCheck: true,
        // Spot check: the picker stops margin..maxMargin px outside the spawn/rage box, watches watchMs and judges the pack.
        // groupGap: passive kinds chained this close are one pull (groupRule); aggroPack: a whole aggro spawn is one pull.
        spotCheck: { enabled: true, party: true, margin: 150, maxMargin: 150, watchMs: 3000, maxWaitMs: 30000, groupGap: 60, groupRule: false, aggroPack: false },
        // Learned hit factor: from minHits real hits of a kind, its predicted hits are scaled by real / predicted (1..max).
        hitFactor: { enabled: true, minHits: 8, max: 5, keepHits: 400 },
        // Mobbing (more than 3 on one player multiply its hits): guard - no new monster while maxOnOne are on one of us
        // (unless the multiplier stays <= guardMinMult); projectSec - the live check looks this far ahead.
        mobbing: { enabled: true, guard: true, maxOnOne: 3, guardMinMult: 1.25, projectSec: 4, healShare: 0.8 }, // healShare: share of a healer's heal/s counted in the live check
        // Rage zones (map "rage" boxes): the spawn counts as a whole; failing it we stay out and call the Cavalry.
        rage: { enabled: true },
        // From fromLevel a monster is checked again with its real stats before a pull.
        live: {
            fromLevel: 2,
            ownHits: 6,           // members/solo picking their own target: survive this many real hits
            soloHpUse: 0.7,       // solo: HP lost over the whole fight (after own healing) at most this share of max HP
            waitTolerance: 2.5,   // only while the team stats are not in yet: real/level-1 damage ratio cap (level-5 CGoo: 1.9x)
        },
    },
};
