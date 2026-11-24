// =====================================================================
// safety/deaths.js - deaths and farm experience: a fighter's death blocks its farm target for an hour, the farm clock, deaths the members report.
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const util = deps.util;
    const party = deps.party;
    const PROVEN_MS = 15 * 60 * 1000;
    const EXP_KEY = "bot_farm_experience:" + character.name;

    function saveExperience() {
        try { set(EXP_KEY, tgt.experience); } catch (e) { /* storage unavailable */ }
    }
    function provenByUs(monster) {
        const e = tgt.experience[monster];
        return !!e && e.ms >= PROVEN_MS && Date.now() - e.at < 24 * 60 * 60 * 1000;
    }
    function recentDeath(monster) {
        const e = tgt.experience[monster];
        return !!e && !!e.bad && Date.now() - e.bad < 60 * 60 * 1000;
    }
    // Leader: count the time spent on the current farm target; a death wipes it.
    function clock() {
        const now = Date.now();
        const dt = tgt.lastClock ? Math.min(5000, now - tgt.lastClock) : 0;
        tgt.lastClock = now;
        if (party.isMember || !tgt.farm || !tgt.farm.monster || tgt.farm.any) return;
        const e = tgt.experience[tgt.farm.monster] || (tgt.experience[tgt.farm.monster] = { ms: 0, at: now });
        // Only a death at the farm spot counts: on the farm map with such a monster nearby
        // (a death on the way or at a hunt somewhere else must not mark this monster).
        // Only fresh deaths (2026-11-19): a member still lying dead after the farm target changed
        // closed the NEW spot too (booboos after a mummy death). Every fighter reports its own
        // death with the monster that killed it (combat/death.js), so this is only a fallback.
        if (tgt.farm.monster !== tgt.clockMonster) { tgt.clockMonster = tgt.farm.monster; tgt.clockSince = now; }
        // The fallback waits for the dead fighter's own report (2026-11-22): the warrior killed by a Fire Spirit next to
        // the Giant Scorpions reported "fireroamer", but this check saw a gscorpion within 500 px in the same tick and
        // closed the gscorpion spot for an hour as well. A death with a report (diedAt, killer by damage) is never
        // counted here; one without a report only after 15 s.
        Object.keys(tgt.pendingDeath).forEach(function (n) {
            const p = n === character.name ? character : get_player(n);
            if (!p || !p.rip) delete tgt.pendingDeath[n];
        });
        const dead = (now - tgt.clockSince < 15 * 1000) ? null : [character.name].concat(party.memberNames()).find(function (n) {
            const p = n === character.name ? character : get_player(n);
            if (!p || !p.rip) return false;
            if (tgt.deathReported[n] && now - tgt.deathReported[n] < 5 * 60 * 1000) return false; // it told us what killed it
            if (!tgt.pendingDeath[n]) tgt.pendingDeath[n] = now;
            if (now - tgt.pendingDeath[n] < 15 * 1000) return false;
            if (tgt.farm.map && p.map !== tgt.farm.map) return false;
            const m = get_nearest_monster({ type: tgt.farm.monster });
            return !!m && Math.hypot(m.x - p.x, m.y - p.y) < 500;
        });
        if (dead) {
            if (!(e.bad && now - e.bad < 60 * 1000)) {
                util.log("target", dead + " died while farming " + tgt.farm.monster + " - not counted as safe for an hour", "red");
                tgt.experience[tgt.farm.monster] = { ms: 0, at: now, bad: now };
                saveExperience();
                tgt.nextPickAt = 0;
            }
            return;
        }
        if (tgt.farm.map && character.map !== tgt.farm.map) return; // still travelling
        const before = e.ms;
        e.ms += dt;
        e.at = now;
        if (before < PROVEN_MS && e.ms >= PROVEN_MS) util.log("target", tgt.farm.monster + ": 15 min without deaths - counts as safe for the team", "green");
        if (now - tgt.lastSave > 60 * 1000) { tgt.lastSave = now; saveExperience(); }
    }

    // A fighter died while its farm target was `monster`: not safe for an hour. Every
    // fighter reports its own death (combat/death.js), so a whole-team wipe counts too – the
    // leader's clock() only sees deaths while it is alive itself.
    function diedAt(monster, who) {
        if (who) tgt.deathReported[who] = Date.now();
        if (!monster || !G.monsters[monster]) return;
        const now = Date.now();
        const e = tgt.experience[monster];
        if (e && e.bad && now - e.bad < 60 * 1000) return; // already noted for this wipe
        util.log("target", who + " died while farming " + monster + " - not counted as safe for an hour", "red");
        tgt.experience[monster] = { ms: 0, at: now, bad: now };
        saveExperience();
        tgt.nextPickAt = 0;
    }
    function deathAt(monster) {
        const e = tgt.experience[monster];
        return (e && e.bad) || 0;
    }

    Object.assign(tgt, {
        saveExperience: saveExperience,
        provenByUs: provenByUs,
        recentDeath: recentDeath,
        clock: clock,
        diedAt: diedAt,
        deathAt: deathAt,
    });
};
