// =====================================================================
// combat/death.js - our own death: the analysis, the boss pause, the revive wait, respawn.
// Part of bot_fighter (module plan, stage 5): moved verbatim from the old single-file core/fighter.js. The parts share
// one internal state (ftr: the farm target, walks, waits, the strike intent, chests) and call each other through ftr;
// outside dependencies come in deps (game, util, config, comms, bus, party, targeting, supply, events, cave, hunts,
// gear, teamStats, cls - the class module).
// =====================================================================

module.exports = function install(ftr, deps) {
    const config = deps.config;
    const util = deps.util;
    const targeting = deps.targeting;
    const party = deps.party;
    const cls = deps.cls;
    const PAGE = parent;
    const HIT_LOG_MS = 10 * 1000;

    function handleDeath() {
        if (!character.rip) { ftr.deathReported = false; return false; }
        if (!ftr.deathReported) {
            ftr.deathReported = true;
            try { ftr.logDeathAnalysis(); } catch (e) { /* analysis only */ }
            if (deps.events && deps.events.onOwnDeath) { try { deps.events.onOwnDeath(); } catch (e) { /* report only */ } }
            // Blame the killer, not the farm target: a death on the way (e.g. vampire rats at
            // the underground entrance on the way to the CGoos) must not close the farm spot.
            // Monsters on us first, else the nearest one close by; the farm target only when
            // one of its kind is near.
            const near = Object.values(parent.entities || {}).filter(function (e) {
                return e && e.type === "monster" && !e.dead && G.monsters[e.mtype] && !G.monsters[e.mtype].cooperative;
            }).sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); });
            const onMe = near.find(function (e) { return e.target === character.name; });
            const close = near.find(function (e) { return util.distanceTo(e) < 250; });
            const farmType = ftr.lastFarm && !ftr.lastFarm.any ? ftr.lastFarm.monster : null;
            const farmNear = farmType && near.find(function (e) { return e.mtype === farmType && util.distanceTo(e) < 500; });
            // First choice: the kind that did the most damage in the last seconds (the hit log) -
            // 2026-11-19 the warrior died to mummies, but by the time it was reported the leader had
            // switched to booboos and the death closed the booboo spot.
            const dealt = {};
            const now = Date.now();
            (PAGE.__botHits || []).forEach(function (h) {
                if (now - h.t > HIT_LOG_MS) return;
                const type = String(h.who || "").split(" ")[0];
                if (G.monsters[type]) dealt[type] = (dealt[type] || 0) + h.dmg;
            });
            const killer = Object.keys(dealt).sort(function (a, b) { return dealt[b] - dealt[a]; })[0] || null;
            const monster = killer || (onMe ? onMe.mtype : close ? close.mtype : farmNear ? farmType : null);
            // The class hook gets the same killer (2026-11-23: the warrior's Agitate block named the farm target).
            if (cls.onDeath) { try { cls.onDeath(monster); } catch (e) { /* class hook only */ } }
            if (monster) {
                // A member reports to the leader and notes it itself as well: farming on its own
                // (detached) it picks with its own records (2026-11-18: the warrior died three
                // times at the moles, the spot was closed only for the leader).
                if (party.isMember) deps.comms.send(config.leader, "died", { monster: monster });
                targeting.diedAt(monster, character.name);
            }
        }
        if (Date.now() < ftr.reviveWaitUntil) {
            util.status("dead - a priest is reviving me", "yellow");
            return true;
        }
        util.status("dead - waiting to respawn", "red");
        if (Date.now() - ftr.lastRespawnTry > 5000) {
            ftr.lastRespawnTry = Date.now();
            respawn().catch(function () {}); // only succeeds once the death timer ran out
        }
        return true;
    }

    Object.assign(ftr, {
        handleDeath: handleDeath,
    });
};
