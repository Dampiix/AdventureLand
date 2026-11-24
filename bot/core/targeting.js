// =====================================================================
// bot_targeting – WHAT to farm and WHICH monster to hit next.
//
// Farm choice, in order:
//   1. a live event / world boss (bot_events)
//   2. members: the leader's farm target - "waiting for the leader" until
//      it is known (no own choice right after a restart)
//   3. an open, safe Monster Hunt of any party fighter (bot_hunts)
//   4. a drop route for an item the merchant is missing (bot_drops; only
//      without a configured farm target)
//   5. the Cavalry plan (reset a too-strong spot / nuke cavalry.targets)
//   6. per-character or global farm setting (config.characters[name].farm,
//      config.targeting.farm; a list: the first one not blocked)
//   7. the game's progression guide (fromProgression: routes safe for the
//      whole team, best XP first)
//   8. config.targeting.fallback
//
// Target choice (pick):
//   all:           a rare monster in sight (targeting.rare) first
//   leader / solo: current target > monster attacking a party member
//                  > nearest free farm monster, after the spot check from
//                    the edge (spotGate)
//   party member:  current target > monster attacking a party member
//                  > own monster when the farm target is easy (party.spread)
//                  > the leader's target – otherwise members never open fights,
//                  so the tank keeps the aggro
//   then the guards: mobbing (no 4th monster on one of us), fear (courage),
//   and bosses held for the team.
// Safety: team model / live level checks, lone pulls, rage zones (a whole
// spawn comes at once - judged as one pull, failing zones are kept out of).
// =====================================================================

const game = require("../lib/game.js");
const createSpots = require("../safety/spots.js");
const PARTS = [
    require("../safety/deaths.js"),
    require("../safety/team-safety.js"),
    require("../safety/live-safety.js"),
    require("../safety/rage-zones.js"),
    require("../safety/spot-check.js"),
    require("../safety/boss-hold.js"),
    require("../farming/spots-taken.js"),
    require("../farming/farm-choice.js"),
    require("../farming/cavalry-plan.js"),
    require("../farming/target-pick.js"),
];

module.exports = function createTargeting(ctx) {
    // Outside dependencies of the parts (module plan, stage 4b); events, hunts, drops and teamStats are created later or
    // replaced, so they are read when used.
    const deps = {
        game: game, util: ctx.util, config: ctx.config, comms: ctx.comms, party: ctx.party,
        get events() { return ctx.events; }, get hunts() { return ctx.hunts; }, get drops() { return ctx.drops; },
        get cave() { return ctx.cave; }, get teamStats() { return ctx.teamStats; },
    };
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const comms = deps.comms;
    const PAGE = parent;
    const EXP_KEY = "bot_farm_experience:" + character.name;
    const CROWD_KEY = "bot_crowded:" + character.name;
    const STRONG_KEY = "bot_strong_spots:" + character.name;
    // The internal state shared by the parts; they put their functions here too.
    const tgt = { spots: createSpots({ game: game, util: util, config: config }) };
    PARTS.forEach(function (install) { install(tgt, deps); });

    // ---- state and start-up, in the old order (the parts' functions are all there already, as the hoisted functions were) ----
    // Spot geometry (watchPoint, inSpotArea, spotBox, boxDist) lives in safety/spots.js (stage 4a): party uses it too.
    tgt.farm = null;
    tgt.nextPickAt = 0;
    tgt.huntBlockLogAt = 0; // v1.235.3: a hunt waiting for its blocked spot
    tgt.crowdedUntil = {}; // monster -> timestamp: skip this guide choice until then
    tgt.idleSince = 0;       // on the farm map without a free target since

    // ---- team safety ------------------------------------------------------------
    // The guide judges a route only for the character asking (the leader, usually
    // the tank). It also offers borderline routes as a careful "trial" and only
    // counts them as proven from fights it watched since CODE started – a restart
    // forgets that. So:
    //  - every member reports its "safe" monsters (trials included) and its "sure"
    //    ones (safe and not a mere trial),
    //  - the leader remembers the team's own experience (survives restarts): a
    //    monster farmed for 15+ minutes without anyone dying counts as proven,
    //    a death there wipes that,
    //  - a spot needs everyone's "safe", and everyone's "sure" or our own proof
    //    (config.targeting.avoidTrial).
    tgt.reports = {};   // member -> { safe, sure, at }
    tgt.lastReport = 0;
    tgt.lastSkipLog = "";
    tgt.experience = (function () { // monster -> { ms, at, bad }
        try { return get(EXP_KEY) || {}; } catch (e) { return {}; }
    })();
    tgt.lastClock = 0;
    tgt.clockMonster = null, tgt.clockSince = 0; // farm target the clock watches, and since when
    tgt.lastSave = 0;

    tgt.deathReported = {}; // fighter -> when it reported its own death (diedAt)
    tgt.pendingDeath = {};  // fighter -> since when the leader sees it dead without a report

    if (comms) {
        comms.on("died", function (data, from) {
            if (!config.characters[from] || party.isMember) return;
            tgt.diedAt(data && data.monster, from);
        });
        comms.on("safe", function (data, from) {
            if (!config.characters[from]) return;
            tgt.reports[from] = { listed: data.listed || null, safe: data.safe || data.list || [], sure: data.sure || data.list || [], at: Date.now() };
            // Our current guide spot is not acceptable for this member: pick again right away.
            if (tgt.farm && String(tgt.farm.source).startsWith("guide") && tgt.lastingObjector(tgt.farm.monster, null)) tgt.nextPickAt = 0;
        });
    }

    // ---- team model (config.targeting.teamSafety) -----------------------------------
    // The per-member rule above asks every fighter's guide whether it could farm the
    // monster ALONE – so a tank changes nothing. The team model judges the party like
    // the boss check does, from everyone's stats (members report them every minute)
    // and the game's damage formula:
    //   tank:    survives tankHits volleys of `pull` monsters (pullAggressive for monsters
    //            that attack on sight) and the priests' healing covers that damage per
    //            second (x healCover; potions do the rest)
    //   others:  survive otherHits hits of one monster – the tank's Taunt pulls it off
    // Monsters with special abilities are left to the guide (teamSafety.abilities lists
    // the ones we accept).

    // Solo safety of our own (v1.226.8, player decision 2026-11-23): the guide's "safe" knows no kiting - it marked the
    // Huge Crabs unsafe for the mage (240 per hit, but speed 8: they never reach a ranged fighter). Alone (no party) a route
    // the guide calls unsafe is taken when our solo check passes for the level-1 monster: we survive live.ownHits of its hits
    // and the whole fight costs at most live.soloHpUse of our HP - a monster we can kite (util.kiteRisk) hits with the
    // residual risk only. No bosses, no special abilities. targeting.soloOwnCheck false switches it off.
    tgt.soloSafeCache = {};

    // ---- monster levels ---------------------------------------------------------
    // Monsters nobody attacks gain levels over time (game source: +50% base HP, +100%
    // base XP, +5% attack on growing spawns / +12.5% elsewhere per level, a bit faster).
    // All checks above use level-1 stats, so a monster above config.targeting.live.fromLevel
    // is checked again with its real stats before we pull it: the team model when it is
    // on, else ownCheck (party) or soloCheck (alone). Only while the team stats are missing
    // does its attack rate have to stay within live.waitTolerance of the level-1 monster's.
    // Monsters already on us are always fought.
    tgt.liveChecked = {}; // entity id -> { level, ok, at }
    tgt.liveLogged = {};  // "type:level" -> last log
    tgt.soloCostById = {}; // entity id -> HP a solo fight against it costs (soloCheck)
    // Spots where other players farm (2026-11-18: the warrior joined the Eagle party at the
    // biggest bat group while three other bat groups were free): skipped for occupiedForMs,
    // and their free monsters are left alone - ones on us are still fought.
    tgt.occupiedUntil = {}; // "map:x:y" -> timestamp
    // Spots the spot check found too strong (2026-11-22): "map:x:y" -> until. Only that spot - a booboo hunt
    // sent the team to the 5-booboo spawn the team can't take while the 4-booboo one is fine.
    tgt.strongSpotUntil = {};
    tgt.noResetUntil = {}; // monster -> no Cavalry reset planned before (reset found nothing grown, v1.227.2)
    tgt.lastSpot = null;
    tgt.strangerSince = {}; // name -> first seen on our spot (checkOccupied)
    tgt.sharedLogged = "";
    // Busy samples from reportSearch: [time, had a target]. Share of the time with a target over the
    // last windowMs (gaps capped at 5 s) and how much of the window is known.
    tgt.busyLog = [];
    tgt.emptySince = {}; // occupied spot key -> first time we saw it without other fighters

    // ---- lone pulls -------------------------------------------------------------
    // Aggressive monsters attack whoever passes within ~32 px of them, and with rage they
    // stay on that player (game source). So we pull them one at a time: from our range,
    // and only when no other free aggressive monster is near the target, near where we
    // will stand or near the way there (config.targeting.isolation).
    // Harmless ones (every fighter survives 20+ of their real hits) don't count: a whole
    // swarm of bees can't hurt us, and waiting for a lone bee left the team idle (2026-11-17).
    tgt.harmlessSeen = {}; // "type:attack" -> { ok, at }
    // Can we take a whole pack of them at once (isolation.packOf, default the aggressive pull)?
    // Then lone pulls are pointless - the moles were waited for one by one though the team
    // tanks three easily (2026-11-17). Uses the monster's real level (attack, HP).
    // Party leader: the team model; solo: our own hits and sustain against the pack.
    tgt.packSeen = {}; // "type:level" -> { ok, at }
    tgt.packLogged = {}; // "type:level" -> last log

    // ---- rage zones (2026-11-22, server.js rage_logic) --------------------------------
    // Some spawns have a rage box (map data "rage"; today the mummies and both booboo spawns in
    // spookytown): every 4.2 s each monster of that spawn takes a player standing in the box as its
    // target, wherever it is and whether we attacked it or not. The warrior picked one booboo that
    // stood alone, walked in and all 5 came (terrified, dead in 7 s) - three times. So a spawn with a
    // rage box counts as a whole: its live members in and around the box (at least its count), judged
    // with the strongest of them by the pack check (mobbing, fear) or the team model.
    //   - no monster of the kind is picked when it, our stand point or the straight way there lies in
    //     a box that fails (nearestSafe);
    //   - standing in such a box we step out (fighter.leaveRageZone).
    tgt.zonesByMap = {};
    tgt.zoneCache = {}; // key -> { at, ok, why }
    tgt.rageLogged = {}; // zone key -> last log (safety/rage-zones.js rageBlocks)
    // Why none of the farm target's monsters in sight was picked (player request 2026-11-20: the
    // warrior stood idle among free crocs and nothing said why) - once a minute per type.
    tgt.noneLogged = {};
    tgt.noneSeen = {}; // type -> { at, seen, unsafe, taken } of the last explainNone (too-strong spots, 2026-11-21)

    // ---- spot check from the edge (2026-11-22) -------------------------------------
    // The guide calls a route safe from level-1 stats, and our own checks only judged the monster we
    // pick - but walking to the middle of the spot pulls whatever is there. 05:31Z: the warrior walked
    // into the grown booboo pack (aggro 1.5, range 420, faster than us) his own check had just refused
    // ("skipping booboo level 17") and died; 05:34Z level-15 bbpompoms at the next spot. So the one who
    // picks the spot (solo, leader) first stops at the edge - its spawn box (the rage box where there is
    // one) plus the monster's range + 50 px (spotCheck.margin .. maxMargin) - looks for spotCheck.watchMs
    // and judges what is there:
    //   aggressive kinds (they join fights, or a rage zone): all free ones in sight come at once - the
    //   pack check (team model as leader, our own hits and sustain solo) with the strongest of them;
    //   passive kinds: at least one of them passes our live check.
    // Fails: the spot is blocked like a too-strong one (until the Cavalry is ready, see markCrowded) and
    // another target is picked. Passed: no new check until we leave the map or the target changes.
    // While the check is open no free monster of the kind is picked (ones on us are still fought).
    tgt.gate = null; // { key, state: "walk" | "watch" | "ok", since }

    tgt.objectedSince = {}; // monster -> first objection in the current streak (farming/farm-choice.js lastingObjector)
    // Routes we can walk to (2026-11-21): the guide also lists monsters that only live in an instance
    // (a4 = Orlok in the crypt) - the leader picked it after the squigtoads were taken on EU IV, and
    // every route to "a4" failed ("Unrecognized location").
    tgt.walkableSeen = {}; // monster -> it spawns on a map outside instances
    // The team's XP ranking - the same list the farm pick walks (guide routes by XP/s, every
    // monster the team may take), crowded spots not left out. Monster names, best first; null
    // while the guide has no routes. Cached 60 s. For hunts.xpTop (player decision 2026-11-20).
    tgt.rankCache = null;

    // The crowded check's sliding window (farming/spots-taken.js reportSearch).
    tgt.win = null; // { monster, start, last, idle }
    // A spot found crowded again soon after the last time is skipped longer each time
    // (crowdedForMs, doubled per repeat up to crowdedMaxMs). Kept across restarts.
    tgt.crowdHistory = (function () { try { return get(CROWD_KEY) || {}; } catch (e) { return {}; } })(); // monster -> { n, at, until }
    Object.keys(tgt.crowdHistory).forEach(function (m) { if (tgt.crowdHistory[m].until > Date.now()) tgt.crowdedUntil[m] = tgt.crowdHistory[m].until; });
    // Too strong, not taken (player decision 2026-11-21): grown monsters (booboos at level 3-19) made
    // the spot "crowded" for 4 h and the team came back to the same grown pack. Now it waits for the
    // Cavalry: blocked until the Cavalry is ready, then cavalryPlan resets it (sentries kill the grown
    // ones, they respawn at level 1) and the block is gone.
    tgt.strongSpots = (function () { try { return get(STRONG_KEY) || {}; } catch (e) { return {}; } })(); // monster -> since
    Object.keys(tgt.strongSpots).forEach(function (m) { tgt.crowdedUntil[m] = Math.max(tgt.crowdedUntil[m] || 0, tgt.cavalryNext()); }); // after a restart too
    tgt.lastFoundAt = 0; // last time we had a target at our farm spot (cavalryPlan)
    tgt.cavPlan = null; // { monster, mode: "reset" | "nuke", since }

    // ---- doomed targets (player decision 2026-11-20, from earthiverse's bot) ---------
    // Every attack the server announces ("action": attacker, target, raw damage, flight time)
    // is noted until its "hit" lands. A monster the damage already in the air will kill is
    // skipped: the warrior no longer walks to a bee that dies on the way, the ranger no longer
    // shoots one the warrior's swing finishes. Minimum damage only (raw x armor/resistance
    // multiplier x 0.9); evasion, reflection and avoidance count as "may miss" (no damage).
    // The listeners live on the game page and are swapped on each load (like the hit log).
    try {
        PAGE.__botInflight = {};
        PAGE.__botDoomedSkips = PAGE.__botDoomedSkips || 0;
        game.onSocket("action", "Act", function (d) {
            try {
                if (!d || !d.damage || d.heal || !d.target || !d.pid) return;
                const t = PAGE.entities && PAGE.entities[d.target];
                if (!t || t.type !== "monster") return;
                PAGE.__botInflight[d.pid] = { target: d.target, attacker: d.attacker, type: d.type, damage: d.damage, until: Date.now() + (d.eta || 0) + 600 };
            } catch (e) { /* estimate only */ }
        });
        game.onSocket("hit", "ActHit", function (d) {
            try { if (d && d.pid && PAGE.__botInflight) delete PAGE.__botInflight[d.pid]; } catch (e) { /* estimate only */ }
        });
    } catch (e) { /* no socket */ }
    tgt.lastRareId = null;
    tgt.holdLogged = 0;
    tgt.fearLogged = 0; // last fear-guard log (see pick)
    // ---- mobbing guard and live danger (2026-11-22, see util.mobbing) ----------------
    // More than 3 monsters on one of us multiply every hit on that one. So no new free monster while
    // one of our fighters already has mobbing.maxOnOne (3) on it - unless the new one hits so hard that
    // mobbing adds at most guardMinMult (strong monsters: 300 / attack is small). Monsters already
    // on us or a member are fought as usual. Agitate decides with its own pack check.
    tgt.mobLogged = 0;

    return { currentFarm: tgt.currentFarm, farmNow: function () { return tgt.farm; }, pick: tgt.pick, xpRanking: tgt.teamXpRanking, heldBossNear: tgt.heldBossNear, doomed: tgt.doomed, reportSearch: tgt.reportSearch, isTeamSafe: tgt.isTeamSafe, whyUnsafe: tgt.whyUnsafe,
        diesSoon: tgt.diesSoon, luckCatcherNear: tgt.luckCatcherNear,
        teamModelOn: tgt.teamModelOn, teamVerdict: tgt.teamVerdict, spotGate: tgt.spotGate, liveDanger: tgt.liveDanger, rageZoneHere: tgt.rageZoneHere, failingZoneAt: tgt.failingZoneAt, bossHoldRing: tgt.bossHoldRing, holdingBoss: tgt.holdBossQuiet, inSpotArea: tgt.spots.inSpotArea, cavalryEdge: tgt.cavalryEdge, spotGateWatchNow: tgt.spotGateWatchNow, rageBoxes: tgt.rageBoxes, failingZoneNear: tgt.failingZoneNear, safetyReport: tgt.safetyReport, waitForLone: tgt.waitForLone, watchPoint: tgt.spots.watchPoint, standPoint: tgt.standPoint, aggressive: tgt.aggressive, diedAt: tgt.diedAt, deathAt: tgt.deathAt, spotFor: tgt.spotFor, inOccupied: tgt.inOccupied, packVerdict: tgt.packVerdict, 
        // HP a solo fight against this monster costs (0 if it was never checked: harmless or low level).
        soloCost: function (e) { return (e && tgt.soloCostById[e.id]) || 0; } };
};

