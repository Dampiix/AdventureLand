// Defaults of encounters/ and events/ (stage 7b): config.js fills these in where it has no value of its own (ours
// always win). Our bosses (policy, minLevel, search, engage, farmBosses, holdFor, runner and scout bosses) and the
// Witch's Cipher spots stay in config.js.
module.exports = {
    events: {
        enabled: true,
        observe: true,                  // log which events are live and what we do
        // Join events on a normal map: their monster types, where join() puts us (joined within r px), what the team must
        // handle to go (joinNeeds); "1hp": hit the boss only while a FOREIGN player holds it (foreignOnly).
        joinTypes: { crabxx: ["crabx", "crabxx"] },
        joinSpot: { crabxx: { map: "main", x: -1000, y: 1700, r: 600 } },
        joinNeeds: { crabxx: "crabx" },
        foreignOnly: { crabxx: "1hp" },
        // neverBy never hit it; the others only while the holder is visible, above holderMinHp and within holderMaxDist px.
        // flee: its target runs fleeStep px away every tick (util.foreignOnlyBlocks, fighter.gigaFlee).
        foreignRules: { crabxx: { neverBy: ["priest"], holderMinHp: 0.4, holderMaxDist: 400, flee: true, fleeStep: 250 } },
        noArea: ["crabxx"], // no Taunt, Agitate, Cleave, Stomp, multi-shot or Absorb on these
        // splitSearch: spawn areas split between the fighters; holdForTeam: open only with everyone within holdRange px.
        splitSearch: true, splitWaitMs: 4 * 60 * 1000, holdForTeam: false, holdRange: 350,
        searchEveryMs: 20 * 60 * 1000,  // search again this long after a miss or a kill
        // Witch's Cipher (events.js cipherFarm): from leadMs before a round until its gathering ends the team farms the
        // scarcest ingredient at the first safe spot of spots[ingredient] (highest HP first); no report: fallback.
        witchCipher: { farm: true, leadMs: 10 * 60 * 1000, fallback: "embercoal" },
        // Merchant scout (roles/merchant/scout.js): searches `bosses` between chores; the runner steps in while it is
        // unavailable or a boss is overdue by fallbackMs. Finds are reported for reportMs, `watch` bosses until a fighter is
        // within teamNear px. safeWalk: its paths avoid aggressive monsters (pad px) and rage zones (ragePad px).
        scout: {
            fallbackMs: 10 * 60 * 1000, lapMaxMs: 15 * 60 * 1000, freshMs: 90 * 1000,
            reportMs: 3000, holdMs: 3 * 60 * 1000, arriveRadius: 300, arriveGraceMs: 10 * 1000,
            keepAway: 250, teamNear: 300, watchMs: 3 * 60 * 1000, lostMs: 8000, spotMs: 3000, pauseAfterDeathMs: 30 * 60 * 1000,
            mapOrder: ["main", "arena", "cave", "halloween"],
            // hits: only aggressive monsters that kill the merchant in this many hits are walled.
            safeWalk: { enabled: true, pad: 100, ragePad: 100, offMs: 60 * 1000, hits: 2 },
        },
        // Runner (events.runnerCandidate: fastest ranged fighter, never leader or healer): searches its bosses alone.
        // maxMs: the leader gives up on it; killMs: longest solo fight.
        runner: {
            maxMs: 8 * 60 * 1000,
            killMs: 3 * 60 * 1000,
            // Nonstop mode: farmBosses hunted by the runner alone while the boss check says it can win.
            nonstopKillMs: 15 * 60 * 1000, // longest solo fight
            nonstopMaxMs: 20 * 60 * 1000,  // one lap plus a fight; the leader gives up after this
        },
        // A seen kill of a slow boss (respawn > 200 s): searched again at kill + respawn x respawnFactor.
        respawnFactor: 0.72,
        farmBossEveryMs: 10 * 1000,     // farmBosses: searched again after this
        searchSpotMs: 4000,             // look around this long at each spawn area
        // Boss check (bosses only; the guide never calls them safe): from everyone's stats
        // and the game's damage formula. Other players are not counted on.
        boss: {
            minHits: 6,                 // every fighter must survive this many hits in a row
            minHitsNonTank: 4,          // ...the others only this many while a tank (warrior/paladin) is in the team
            minHitsNonTankBy: { skeletor: 2 }, // per boss instead of minHitsNonTank
            healCover: 1.5,             // damage/s on the tank <= priests' healing/s x this (potions do the rest)
            maxFightMinutes: null,      // kill-time limit for the team alone; null = none
            priestDamageShare: 0.3,     // priests mostly heal: count this share of their damage
            // Solo (no priest): HP/s a fighter keeps up with potions and its own sustain.
            soloSustainHps: 150,
            pauseAfterDeathMs: 3 * 60 * 60 * 1000, // a death there pauses the boss this long
        },
    },
};
