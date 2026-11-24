// Defaults of farming/ (stage 7b): config.js fills these in where it has no value of its own (ours always win). Our
// farm target, fallback, rare kinds, hunt allow / deny lists, extra drop stock and Cavalry targets stay in config.js.
module.exports = {
    // Monster Hunts (Daisy). Unsafe hunts are left to expire.
    hunts: {
        enabled: true,
        minLevel: 20,                    // only once every fighter has this level (Daisy ignores our level)
        xpTop: 5,                        // only monsters among the team's top xpTop XP spots (0 = every safe hunt)...
        dropHunts: true,                 // ...or that drop something the merchant misses (wish or craft ingredient)
        minRemainingMs: 2 * 60 * 1000,   // skip hunts about to expire
        teamSpeedup: 2,                  // the team kills ~2x as fast as the leader alone (time check)
        visitCooldownMs: 10 * 60 * 1000, // at most one Daisy trip per 10 min
        waitAtDaisyMs: 6000,             // leader waits at least this long at Daisy...
        waitAtDaisyMaxMs: 45000,         // ...and up to this until every member is done there
        finishedRetryMs: 60 * 1000,      // a finished hunt: next Daisy trip after this at the earliest
        daisyRange: 200,                 // how close counts as standing at Daisy
        shareMs: 10000,                  // members report their hunt to the leader this often
    },

    // Items that can't be bought come before XP: the merchant reports what is missing, the guide names the drop route.
    drops: {
        enabled: true,
        maxHoursPerCopy: 100,       // slower drops are not farmed (a sanity cap; wishes compete by value)
        refreshMs: 5 * 60 * 1000,   // leader re-asks the guide this often
        reportMs: 5 * 60 * 1000,    // merchant reports shortages this often
        // Drop spots vs the XP spot by value per hour; a switch needs valueSwitch x the current choice's value.
        byValue: true,
        valueSwitch: 1.2,
        // Own loot gold per farm target over windowH hours (after minMinutes, fighters within togetherRange px).
        spotGold: { enabled: true, windowH: 3, minMinutes: 10, togetherRange: 500 },
    },

    targeting: {
        // Waiting at a farm zone for the Cavalry: within this many px of the zone (farming/cavalry-plan.js).
        cavalryEdge: 90,
        // Rare monsters attacked first when in sight within range px; skipped while invulnerable.
        rare: { enabled: true, range: 400 },
        // Guide "careful trial" routes count only once proven (own fights or 15 min of team farming without a death).
        avoidTrial: true,
        // Melee classes never hit monsters returning more than maxDreturn % damage (porcupine 4800); ranged ones farm them.
        melee: { classes: ["warrior", "paladin", "rogue"], maxDreturn: 20 },
        // The farm spot is left only when a member's "unsafe" lasts this long; a death there counts at once.
        objectionGraceMs: 5 * 60 * 1000,
        refreshMs: 5 * 60 * 1000, // how often to ask the guide again
        crowdedAfterMs: 90 * 1000,    // no free target this long on the farm map -> spot is crowded
        // ...or this share of a window without a free target:
        crowdedWindowMs: 3 * 60 * 1000, crowdedIdleShare: 0.7, // idle = not in range of a target (walking counts)
        crowdedForMs: 60 * 60 * 1000,  // then use the guide's next choice for this long,
        // Another player within occupiedRadius px of our spot: skipped for occupiedForMs; free again after occupiedFreeMs alone.
        occupiedBy: 1, occupiedRadius: 300, occupiedAfterMs: 20000, occupiedForMs: 60 * 60 * 1000, occupiedFreeMs: 30 * 1000,
        // Shared, not taken: we stay while we had a target stayIfBusy of the last shareWindowMs.
        stayIfBusy: 0.75, shareWindowMs: 2 * 60 * 1000, shareMinMs: 60 * 1000,
        crowdedMaxMs: 6 * 60 * 60 * 1000, // doubled each time the same spot is crowded again within a day
    },

    // Cavalry (Tracktrix; strong only while our highest level is below 80): emergencies and spots the spot check blocked.
    // reset: also reset grown farm spots. foreignClear: no call with another level-3+ kind this close; *MinCount/PackMin:
    // wait for this many in reach.
    cavalry: { enabled: true, emergencyHpBelow: 0.35, emergencyOnMe: 1, reset: false, resetFromLevel: 5, resetMinCount: 2,
        planStayMs: 100 * 1000, planMaxMs: 10 * 60 * 1000, foreignClear: 420, planMinCount: 5, resetPackMin: 5 },
};
