// =====================================================================
// classes/warrior/splash.js - splash weapons outside the Agitate modes: on with several monsters on us when the splash pays and pulls no more than we can hold, off on the way and away from the farm target.
// Part of the warrior (module plan, stage 2): moved verbatim from the old single-file warrior.js. The warrior's parts
// share one internal state (w: the pack, the auto decision, the last Agitate, the speed reference) and call each
// other through w; outside dependencies come in deps (game, util, config, party, targeting, gear, strike, events).
// =====================================================================

module.exports = function install(w, deps) {
    const game = deps.game;
    const util = deps.util;
    const quiet = util.quiet;
    const c = deps.config.classes.warrior;
    const ag = c.agitate || {};
    const mpLeftAfter = util.mpLeftAfter;

    // Splash weapons only where splash is right (player decision 2026-11-18): away from the farm
    // target - travelling, an event, a fight with something else - the usual weapons go back on.
    // On the way to the Phoenix a Big Bird taunted off the priest got the Lolipops, and their
    // splash pulled every Big Bird spawning next to the party.
    // Splash without Agitate (player request 2026-11-19): with splashOnlyFrom or more monsters on
    // us of a kind whose splash pays (measured, or guessed from the spawn density) the Lolipops go
    // on even where Agitate is not allowed - 6-7 mummies stood on the warrior and he hit them with
    // swords. Held a few seconds after the crowd thins out (no swapping back and forth).
    let splashOnlyUntil = 0;
    // What the splash would pull (2026-11-22): the splash hits the free monsters next to our targets, they attack us,
    // and their neighbours get hit next - at the X-scorpions 3 on us became 6 and the warrior died (the team model
    // says no to 6 at once: 2746 dmg/s vs 1492 healing/s). Those on us plus every free monster chained within the
    // splash radius (+ splashPullSlack px for walking in), three rounds deep.
    function splashPull(on) {
        const r = w.splashRadius() + (ag.splashPullSlack || 40);
        const free = Object.values(game.entities()).filter(function (e) {
            return e && e.type === "monster" && !e.dead && !e.target;
        });
        const set = on.slice();
        let frontier = on.slice();
        for (let round = 0; round < 3 && frontier.length; round++) {
            const next = free.filter(function (m) {
                return set.indexOf(m) === -1 && frontier.some(function (t) { return w.edge(m, t) < r; });
            });
            next.forEach(function (m) { set.push(m); });
            frontier = next;
        }
        return set;
    }
    // Would we survive all of them? Party: the team model (healing counts), solo: the pack check's safe count.
    let splashDenyLog = 0;
    function splashPullOk(type, all) {
        const ofType = all.filter(function (m) { return m.mtype === type; });
        const strongest = (ofType.length ? ofType : all).slice().sort(function (a, b) { return (b.level || 1) - (a.level || 1); })[0];
        let v = null;
        if (deps.party.enabled && deps.targeting.teamVerdict) {
            v = deps.targeting.teamVerdict(type, strongest, { pull: all.length });
            if (!v.ok && /waiting for the team|not in yet/.test(v.why || "")) v = null; // no team stats yet: the solo count
        }
        if (!v) {
            const n = w.safeLimit(type);
            v = all.length <= n ? { ok: true } : { ok: false, why: "pack check allows " + n };
        }
        if (!v.ok && Date.now() - splashDenyLog > 30 * 1000) {
            splashDenyLog = Date.now();
            util.log("warrior", "no splash: it would pull " + all.length + " (" + v.why + ")", "orange");
        }
        return v.ok;
    }

    let travelOffLog = 0;
    function dropSplashOnTheWay() {
        if (!w.travelling() || !w.wearingSplash()) return;
        splashOnlyUntil = 0;
        if (deps.gear.weaponsHeld()) deps.gear.holdWeapons(0); // the next equip pass puts the usual weapons back on
        if (Date.now() - travelOffLog > 30 * 1000) {
            travelOffLog = Date.now();
            util.log("warrior", "splash weapons off: on the way", "white");
        }
    }
    function splashOnly() {
        if (w.travelling()) { splashOnlyUntil = 0; return false; }
        if (ag.monsters !== "auto" || w.agOverride() || !(ag.splashOnlyFrom > 0)) return false;
        const on = w.onMe();
        if (on.length >= ag.splashOnlyFrom) {
            const count = {};
            on.forEach(function (m) { count[m.mtype] = (count[m.mtype] || 0) + 1; });
            const type = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
            if (w.splashWorth(type)) {
                if (splashPullOk(type, splashPull(on))) splashOnlyUntil = Date.now() + (ag.splashOnlyHoldMs || 8000);
                else splashOnlyUntil = 0; // too many would come: the usual weapons (the hold ends at once)
            }
        }
        return Date.now() < splashOnlyUntil;
    }
    function releaseSplash() {
        if (splashOnly()) {
            if (!w.wearingSplash() && w.splashWeapons().length && !w.pack.busy) {
                util.log("warrior", "splash weapons on: " + w.onMe().length + " on us (without Agitate)", "white");
                w.putOnSplash();
            }
            if (w.wearingSplash()) deps.gear.holdWeapons(ag.keepMs || 60 * 1000);
            return;
        }
        if (ag.monsters === "auto" && !w.agOverride() && w.wearingSplash() && deps.gear.weaponsHeld()) {
            deps.gear.holdWeapons(0);
            util.log("warrior", "splash weapons off (no farm target around)", "white");
        }
    }

    Object.assign(w, {
        splashPull: splashPull,
        splashPullOk: splashPullOk,
        dropSplashOnTheWay: dropSplashOnTheWay,
        splashOnly: splashOnly,
        releaseSplash: releaseSplash,
    });
};
