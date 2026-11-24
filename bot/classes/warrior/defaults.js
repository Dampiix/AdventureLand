// Defaults of classes/warrior/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
// Warrior (classes/warrior/): agitate-*, protect, escape, splash, sword-swap, mobility. Details: the module headers.
module.exports = {
    classes: {
        warrior: {
            mpReserveRatio: 0.2,
            // Taunt off an ally below allyHpBelow or hit for hitRatio+ of its max HP; always bosses (max HP >= bossHp) and
            // monsters on our healer. walkFirst: walk within closeBy px first (unless below urgentHpBelow).
            taunt: { enabled: true, first: false, agitateOver: 6, allyHpBelow: 0.8, hitRatio: 0.05, bosses: true, bossHp: 20000, offHealer: true,
                walkFirst: true, closeBy: 25, urgentHpBelow: 0.5 },
            agitateFrom: 3,                 // Agitate (lvl 68) when this many monsters are on allies
            cleaveFrom: 3,                  // Cleave (lvl 52, axe/scythe) with this many monsters around
            stompFrom: 2,                   // Stomp (lvl 52, basher) with this many attackers
            sturdyHits: 4,                  // War Cry (lvl 70) on targets needing this many hits
            hardShell: { enabled: true, factor: 3 }, // lvl 60: when the predicted next physical hits x factor reach our HP
            useCharge: true,                           // +30 speed whenever we walk (on cooldown)
            // Dash (combat, 120 MP): toward the target from `from` px, at most `max` px (server limit 50), one per everyMs.
            dash: { enabled: false, from: 80, max: 49, minMpRatio: 0.5, everyMs: 1000, pauseMs: 10000 },
            // Sword swap: `count` Swords of the Dead for targets dying in maxHits hits (burn never procs on the killing hit);
            // fire blades back holdMs after the last quick target.
            swordSwap: { enabled: true, count: 2, maxHits: 5, holdMs: 60 * 1000 },
            // Agitate pack mode (lvl 68): splash weapons, War Cry + Agitate, hit the target with the most splash neighbours.
            agitate: {
                enabled: true,
                maxOnMe: 8, maxHp: 50000, abilities: [], // auto: at most this many at once; no bosses / unknown abilities
                splashOnlyFrom: 3, splashOnlyHoldMs: 8000, // Lolipops without Agitate with this many on us (splash must pay)
                splashPullSlack: 40, // ...if we survive what the splash pulls: chained within splash radius + this (px)
                offAfterMs: 60 * 1000, // a running auto mode goes off on a live "no" only after it held this long
                fearMax: 0, // attackers of one damage type beyond our courage for it (each one more costs 20-40 % attack)
                maxLevel: null, safetyShare: 0.5, // auto: null = no level cap; a pull may cost only this share of the HP the pack check allows
                splashMin: 1.0, learnHits: 40, denseCount: 5, denseSpacing: 130, // auto: lolipops from 1.0 splash per hit (guess from spawn density first)
                deathDenyMs: 2 * 60 * 60 * 1000, // auto: no Agitate on a kind for this long after dying to it
                // Escape (escape.js, from slower monsters): below escapeHp, or when the HP lost over escapeLossSec kills us
                // within escapeTtdSec; until nobody reaches us (range + escapeMargin, >= escapeClear px) and HP >= escapeUntilHp.
                escapeHp: 0.3, escapeUntilHp: 0.6, escapeMaxMs: 45000, escapeClear: 250, escapeMargin: 100, escapeStep: 200, escapeKeepOff: 80, escapeLossSec: 3,
                // Mobbing: escape below escapeMobHp if the live combo kills us within escapeTtdSec; no Agitate within mobStopTtdSec.
                escapeMobHp: 0.7, escapeTtdSec: 8, mobStopTtdSec: 20,
                partyEscape: true, // in a party too (healing counted), staying within the healer's reach where possible
                // Gap step: minOnMe+ on us and the splash misses one in range -> `step` px into the largest angle gap.
                gapStep: { enabled: true, step: 50, everyMs: 4000, minMs: 2500, minOnMe: 3 },
                minPack: 3,
                minHp: 0.8,           // start a pull only above this HP share
                abortHp: 0.3,         // below: walk away from the pack
                centerWithin: 20,     // "center": at the pull point within this distance
                searchRadius: 200, gridStep: 40, // "center": pull points tried around us
                // No other kind within reach + clearMargin px when we Agitate; else move within clearSearch px (none: skip).
                clearMargin: 80, clearSearch: 240,
                // Toward the spot middle: beyond homeSlack px from the spawn middle, Agitate from a point up to homeStep px
                // nearer (gain >= homeMinGain); homePxPerMonster px nearer is worth one free monster more.
                home: true, homeSlack: 100, homeStep: 160, homeMinGain: 40, homeNear: 600, homePxPerMonster: 40,
                avgPerMonster: 60,    // "center": one monster more in reach is worth this much less average way (px)
                sideStep: 50,         // "center": step out of the pack after Agitate (0 = stay)
                adjustStep: 40, adjustEveryMs: 4000, // "center": step when monsters come from behind
                waitShare: 0.7, waitMs: 3000, // first swing once this share of the pulled pack is in range (at most waitMs)
                chaseFrom: 3,         // with this many or fewer left and none in range: walk to the nearest one
                streamFrom: 1, streamOnMe: 3, // "stream": Agitate when this many free ones are in reach and fewer than streamOnMe attack us (auto: splashOnMe, so the splash is measured fairly)
                splashOnMe: 5, sugarBonus: 2, agitateEverySec: 6, // "splashstream": at most this many on us; one Agitate per agitateEverySec (mana) ...
                streamLowHp: 0.6, streamStopHp: 0.4, // ... at most 2 below 60% HP, no Agitate below 40%
                streamToClump: true, clumpRadius: 60, clumpStep: 80, // "splashstream": walk to clumps (each neighbour within 60 px is worth 80 px of way)
                kiteStep: 120,        // "step" (and backing off): this far
                gatherMs: 2500,
                regroupBelow: 0.5, regroupEveryMs: 8000, // spread out (fewer splash neighbours per hit than this): another step
                keepMs: 60 * 1000,    // splash weapons stay on this long after a pull
            },
        },
    },
};
