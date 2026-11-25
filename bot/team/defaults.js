// Defaults of team/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
module.exports = {
    party: {
        followDistance: 80,   // members idle within this distance of the leader
        // Agitate range around the leader; a member within it judges rage zones with the team model, else its own check.
        leash: 300,
        farmRadius: 400,      // members pick free monsters only within this of the leader
        broadcastMs: 2000,    // leader shares position/target this often
        inviteEveryMs: 10000, // leader re-invites a missing member this often
        // The leader waits for a fighter farther than waitDistance px (at most waitMaxMs per separation, not while attacked).
        waitForTeam: true, waitDistance: 500, waitMaxMs: 45000, waitAgainMs: 60000,
        // Members walk to the route's end themselves; below toHealerBelow HP they walk into the priest's range.
        goToDest: true, toHealerBelow: 0.5,
        // Team goal reached: within goalEdge px of a farm spot's edge point, else within goalRadius px (party.js).
        goalEdge: 250, goalRadius: 200,
        // The highest gold bonus opens chests (fixed: a name); others only if it is away (awayRange px) or after fallbackMs.
        chestOpener: { enabled: true, fixed: null, awayRange: 400, fallbackMs: 10000 },
        // Ranged fighters keep out of the monsters' melee reach (+margin px) while a tank class is near.
        // holdGoalMs: keep a spacing step's goal this long while walking; slack: px a member may stand too close.
        spacing: { enabled: true, minOwnRange: 100, margin: 50, gap: 130, step: 80, everyMs: 700, holdGoalMs: 2500, slack: 15 },
        // Easy targets members pick themselves near the leader; harmlessRatio: hits for at most this share of our max HP.
        spread: { enabled: true, maxHits: 3, maxDamageRatio: 0.05, harmlessRatio: 0.02 },
        // A member the leader started restarts the leader's code after silentMs without a heartbeat (main.js; slot: bot_main).
        leaderRescue: { enabled: true, silentMs: 3 * 60 * 1000, gapMs: 5 * 60 * 1000, checkMs: 30 * 1000, slot: 20 },
    },
};
