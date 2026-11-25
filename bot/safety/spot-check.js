// =====================================================================
// safety/spot-check.js - the spot check from the edge: the one who picks a spot stops at its edge, watches and judges what is there.
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const cfg = config.targeting;
    const icfg = cfg.isolation || {};
    const gcfg = cfg.spotCheck || {};
    const spotBox = tgt.spots.spotBox;
    const boxDist = tgt.spots.boxDist;

    function gateApplies(f) {
        if (!gcfg.enabled || !f || !f.monster || f.any || f.dest || !G.monsters[f.monster] || G.monsters[f.monster].cooperative) return false;
        if (party.enabled && (party.isMember && !party.detached())) return false;
        if (party.enabled && gcfg.party === false) return false;
        const src = String(f.source || "");
        return !src.startsWith("event") && !src.startsWith("cavalry");
    }
    // null: no restriction. { walk: true }: keep walking to the spot, pick nothing of the kind yet.
    // { hold: true, why }: stand here and watch.
    function spotGate(f) {
        if (!gateApplies(f)) { tgt.gate = null; return null; }
        const spot = tgt.spotFor(f.monster, f.map);
        if (!spot) return null;
        const key = f.monster + "|" + tgt.spotKey(spot);
        if (!tgt.gate || tgt.gate.key !== key) tgt.gate = { key: key, state: "walk", since: Date.now() };
        // Away from the spot's map: whatever state the gate was in, a new arrival is checked again (2026-11-22: a
        // "watch" left over from an earlier visit judged at once on arrival, with nothing in sight).
        if (character.map !== spot.map) { tgt.gate = { key: key, state: "walk", since: Date.now() }; return { walk: true }; }
        if (tgt.gate.state === "ok") return null;
        const box = spotBox(f.monster, spot);
        if (!box) { tgt.gate.state = "ok"; return null; }
        const def = G.monsters[f.monster];
        const margin = Math.max(gcfg.margin || 150, Math.min((def.range || 0) + 50, gcfg.maxMargin || 450));
        const me = util.xy(character);
        if (tgt.gate.state === "walk") {
            if (boxDist(me, box.b) > margin) return { walk: true };
            tgt.gate.state = "watch";
            tgt.gate.since = Date.now();
        }
        if (Date.now() - tgt.gate.since < (gcfg.watchMs || 3000)) return { hold: true, why: "checking the " + f.monster + " spot" };
        // Judge what we see in and around the box.
        const near = [box.b[0] - 150, box.b[1] - 150, box.b[2] + 150, box.b[3] + 150];
        const seen = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && e.mtype === f.monster && !e.dead && boxDist(util.xy(e), near) === 0;
        });
        // Nothing of an aggressive / rage spawn in sight from farther than the edge: walk on and look again from the
        // edge - "none in sight, level 1 assumed" must come from up close (2026-11-22).
        if (!seen.length && boxDist(me, box.b) > margin + 20 && (tgt.joinsFights(def) || box.rage)) {
            tgt.gate.state = "walk";
            return { walk: true };
        }
        const verdict = judgeSpot(f.monster, seen, box);
        // Team stats not in yet: keep watching, at most gcfg.maxWaitMs - then the usual checks decide.
        if (verdict.wait && Date.now() - tgt.gate.since < (gcfg.maxWaitMs || 30000)) return { hold: true, why: "checking the " + f.monster + " spot (team stats)" };
        if (verdict.ok || verdict.wait) {
            tgt.gate.state = "ok";
            util.log("target", "spot check " + f.monster + ": OK - " + (verdict.why || "no team stats yet"), "green");
            return null;
        }
        tgt.gate = null;
        // Only this spot first (2026-11-22): another spawn of the kind may be fine (booboos: 5 no, 4 yes).
        const until = (config.cavalry || {}).enabled ? Math.max(tgt.cavalryNext(), Date.now() + 10 * 60 * 1000) : Date.now() + (cfg.crowdedForMs || 20 * 60 * 1000);
        tgt.strongSpotUntil[tgt.spotKey(spot)] = until;
        if (tgt.allSpotsTaken(f.monster)) tgt.markCrowded(verdict.why, true);
        else {
            tgt.nextPickAt = 0;
            util.log("target", f.monster + " spot " + spot.map + " " + spot.x + "," + spot.y + " too strong (" + verdict.why + ") - trying another " + f.monster + " spot", "orange");
        }
        return { hold: true, why: "spot too strong" };
    }
    // Held back by monsters too strong nearby (waitForLone "strong") before the edge (2026-11-22): the check starts
    // right there - otherwise neither rule moved and the priest stood 170 px from the booboo spawn for good.
    function spotGateWatchNow(f) {
        if (!tgt.gate || !f || !gateApplies(f)) return;
        const spot = tgt.spotFor(f.monster, f.map);
        if (!spot || tgt.gate.key !== f.monster + "|" + tgt.spotKey(spot) || tgt.gate.state !== "walk" || character.map !== spot.map) return;
        // Only near THIS spot (the strong ones may stand at another spawn of the kind - the next spot was judged
        // "none in sight" from 800 px away right after the big booboo spawn failed).
        const box = spotBox(f.monster, spot);
        if (!box || boxDist(util.xy(character), box.b) > (icfg.strongHold || 300) + 50) return;
        tgt.gate.state = "watch";
        tgt.gate.since = Date.now();
    }
    function judgeSpot(type, seen, box) {
        const def = G.monsters[type];
        // None in sight: fine - except where the whole spawn comes anyway (aggressive or a rage zone, 2026-11-22):
        // judged with its count at level 1.
        const none = !seen.length;
        // The whole spawn comes at once only in a map rage zone (v1.235.4, player report + server code 2026-11-24): a
        // monster's aggro means it attacks a player it touches (32 px), rage how long it pursues - the stoneworms
        // (aggro 1, rage 1, no rage zone) were judged as a pack of 4 although they come one by one.
        // spotCheck.aggroPack true brings the old rule back (aggressive kinds judged as a pack everywhere).
        const pack = box.rage || (gcfg.aggroPack === true && tgt.joinsFights(def));
        if (none && !pack) return { ok: true, why: "none in sight" };
        const free = seen.filter(function (e) { return !e.target; });
        const levels = none ? [1] : seen.map(function (e) { return e.level || 1; });
        const lv = (none ? "none in sight, level 1 assumed" : "levels " + Math.min.apply(null, levels) + "-" + Math.max.apply(null, levels));
        if (pack) {
            if (!none && !free.length) return { ok: true, why: "all " + seen.length + " busy" };
            let strongest = none ? { mtype: type, attack: def.attack, max_hp: def.hp, hp: def.hp, frequency: def.frequency, level: 1 }
                : free.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0) || (b.max_hp || 0) - (a.max_hp || 0); })[0];
            // What we saw of this zone earlier (v1.238.0, rage-zones.js): the strongest one may be out of sight now.
            const known = box.rage && tgt.knownAtBox ? tgt.knownAtBox(type, box.b) : null;
            if (known && (known.attack || 0) > (strongest.attack || 0)) strongest = known;
            // No "harmless" shortcut (2026-11-22): it only means 20 single hits - 3 booboos (1.2 hits/s each,
            // pure) passed as harmless and killed the warrior in 10 s. The pack check counts the rate too.
            // The whole spawn, not just what we see from the edge (2026-11-22): the check saw 2 free booboos,
            // 5 came at once out of the rage zone (4x level 2, 1x level 8) - terrified, dead in 7 s.
            const n = Math.max(free.length, box.count || 0);
            const v = tgt.pullVerdict(type, strongest, n);
            if (!v.ok && /waiting for the team/.test(v.why || "")) return { wait: true };
            return v.ok ? { ok: true, why: n + " at once fine (" + free.length + " free in sight, " + lv + ")" }
                : { ok: false, why: n + " in the " + (box.rage ? "rage zone" : "pack") + " (" + free.length + " free in sight, " + lv + ") would come at once: " + v.why };
        }
        const fine = free.filter(function (e) { return !util.tooSpiky(config, e) && tgt.liveSafe(e); });
        if (!fine.length && free.length) return { ok: false, why: "none of " + seen.length + " passes the live check (" + lv + ")" };
        // A tight group comes together (2026-11-22): one at a time each X-scorpion was fine ("6 of 6 fine",
        // levels 10-11), but they stood close - the warrior's splash (and anything else hitting the group) pulled
        // their neighbours, 6 came at once and killed him. The largest group of free ones chained within
        // spotCheck.groupGap px (edge to edge, the splash radius plus walking in) is judged as one pull.
        const gap = gcfg.groupGap || 60;
        let group = [];
        // spotCheck.groupRule false (v1.233.1): no group judging here - the splash users check their pull live.
        if (gcfg.groupRule !== false) free.forEach(function (e) {
            if (group.indexOf(e) !== -1) return;
            const g = [e];
            for (let i = 0; i < g.length; i++) {
                free.forEach(function (o) {
                    if (g.indexOf(o) === -1 && Math.max(0, Math.hypot(o.real_x - g[i].real_x, o.real_y - g[i].real_y) - 20) < gap) g.push(o);
                });
            }
            if (g.length > group.length) group = g;
        });
        if (group.length >= 2) {
            const strongest = group.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0) || (b.max_hp || 0) - (a.max_hp || 0); })[0];
            const v = tgt.pullVerdict(type, strongest, group.length);
            if (!v.ok && /waiting for the team/.test(v.why || "")) return { wait: true };
            if (!v.ok) return { ok: false, why: "a group of " + group.length + " stands together (" + lv + ") and would come at once: " + v.why };
        }
        return { ok: true, why: fine.length + " of " + seen.length + " fine" + (group.length >= 2 ? ", group of " + group.length + " too" : "") + " (" + lv + ")" };
    }

    Object.assign(tgt, {
        gateApplies: gateApplies,
        spotGate: spotGate,
        spotGateWatchNow: spotGateWatchNow,
        judgeSpot: judgeSpot,
    });
};
