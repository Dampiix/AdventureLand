// =====================================================================
// farming/cavalry-plan.js - the Cavalry plan: when the farm spot is crowded or too strong, reset or nuke it with the Cavalry.
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const cfg = config.targeting;
    const CROWD_KEY = "bot_crowded:" + character.name;
    const spotBox = tgt.spots.spotBox;
    const boxDist = tgt.spots.boxDist;

    function cavalryNext() { try { return get("bot_cavalry_next") || 0; } catch (e) { return 0; } }
    // Cavalry readiness as the fighter records it (account-wide, see fighter.cavalryTick).
    function cavalryReady() {
        let next = 0;
        try { next = get("bot_cavalry_next") || 0; } catch (e) { /* storage unavailable */ }
        return Date.now() >= next;
    }
    function cavalryCalledAt() {
        try { return get("bot_cavalry_called") || 0; } catch (e) { return 0; }
    }
    // A spot of `type` found too strong that the team could take with fresh level-1 monsters (the Cavalry's reset
    // brings them back at level 1): the whole spawn at once where it comes at once (aggressive / rage), else one.
    // { map, x, y, why } of the cheapest such spot, or null. Spots other players hold are left out.
    function huntResetSpot(type) {
        const def = G.monsters[type];
        if (!def) return null;
        const now = Date.now();
        let best = null;
        Object.keys(G.maps).forEach(function (m) {
            const map = G.maps[m];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pk) {
                if (pk.type !== type) return;
                const boxes = pk.boundaries ? pk.boundaries : pk.boundary ? [[m].concat(pk.boundary)] : [];
                boxes.forEach(function (b) {
                    const spot = { map: b[0], x: Math.round((b[1] + b[3]) / 2), y: Math.round((b[2] + b[4]) / 2) };
                    const k = tgt.spotKey(spot);
                    if (!(tgt.strongSpotUntil[k] > now) || tgt.occupiedUntil[k] > now) return;
                    const n = tgt.joinsFights(def) || pk.rage ? (pk.count || 1) : 1;
                    const fresh = { mtype: type, attack: def.attack, max_hp: def.hp, hp: def.hp, frequency: def.frequency, level: 1 };
                    const v = tgt.teamModelOn() ? tgt.teamVerdict(type, fresh, { pull: n }) : tgt.packVerdict(fresh, n);
                    if (!v.ok) return;
                    if (!best || n < best.n) best = { map: spot.map, x: spot.x, y: spot.y, n: n, why: n + " at level 1: " + v.why };
                });
            });
        });
        return best;
    }
    // Cavalry reset at a spot with a rage box (2026-11-22): we call from just outside the box, never from inside
    // (inside, the whole spawn targets us, and the sentries only take level 3+). { hold, why } or null (walk on).
    function cavalryEdge(f) {
        if (!f || !String(f.source || "").startsWith("cavalry") || !tgt.cavPlan || !tgt.cavPlan.spot || character.map !== tgt.cavPlan.spot.map) return null;
        const box = spotBox(f.monster, tgt.cavPlan.spot);
        if (!box || !box.rage) return null;
        const gap = boxDist(util.xy(character), box.b);
        return gap <= (cfg.cavalryEdge || 90) ? { hold: true, why: "waiting at the " + f.monster + " zone for the Cavalry" } : null;
    }
    function cavalryPlan(override) {
        const cv = config.cavalry || {};
        const list = tgt.farmList(override);
        // Without a config list: only resets of too-strong spots from the guide's XP list (2026-11-21).
        if (!cv.enabled || (party.enabled && party.isMember && !party.detached())) { tgt.cavPlan = null; return null; }
        const huntsBlocked = !tgt.cavPlan && cavalryReady() && deps.hunts && deps.hunts.blocked ? deps.hunts.blocked() : [];
        if (!tgt.cavPlan && !list.length && !Object.keys(tgt.strongSpots).length && !huntsBlocked.length) return null;
        const now = Date.now();
        if (tgt.cavPlan) {
            const called = cavalryCalledAt();
            let done = called > tgt.cavPlan.since && now - called > (cv.planStayMs || 100 * 1000);
            // Any reset: at the spot with nothing of level 3+ there, there is nothing to reset - the spot check
            // judges it again as it is (2026-11-22 for hunts, v1.227.2 for every reset: the solo mage stood among
            // level-1 Huge Crabs for minutes, "none picked: on another player's spot", because the reset kept the
            // too-strong block on the spot it was meant to clear). Without a spot of its own the plan uses the
            // spot we farm there (lastSpot).
            const planSpot = tgt.cavPlan.spot || (tgt.lastSpot && tgt.lastSpot.type === tgt.cavPlan.monster ? tgt.lastSpot : null);
            if (!done && tgt.cavPlan.mode === "reset" && planSpot && character.map === planSpot.map && !(called > tgt.cavPlan.since)) {
                const box = spotBox(tgt.cavPlan.monster, planSpot);
                if (box && boxDist(util.xy(character), box.b) <= 200) {
                    const near = [box.b[0] - 200, box.b[1] - 200, box.b[2] + 200, box.b[3] + 200];
                    const grown = Object.values(parent.entities || {}).some(function (e) {
                        return e && e.type === "monster" && e.mtype === tgt.cavPlan.monster && !e.dead && (e.level || 1) >= 3 && boxDist(util.xy(e), near) === 0;
                    });
                    if (!grown && now - tgt.cavPlan.since > 20 * 1000) {
                        util.log("target", "cavalry reset at " + tgt.cavPlan.monster + ": nothing of level 3+ there - the spot check decides", "white");
                        delete tgt.strongSpotUntil[tgt.spotKey(planSpot)];
                        // No new reset here for 10 min: should the spot check block it again, the ready Cavalry
                        // would plan the same pointless reset every 20 s.
                        tgt.noResetUntil[tgt.cavPlan.monster] = now + 10 * 60 * 1000;
                        tgt.cavPlan = null;
                        tgt.nextPickAt = 0;
                        return null;
                    }
                }
            }
            const tooLong = now - tgt.cavPlan.since > (cv.planMaxMs || 10 * 60 * 1000);
            if (done || tooLong) {
                util.log("target", "cavalry " + tgt.cavPlan.mode + " at " + tgt.cavPlan.monster + (done ? " done" : " gave up") + " - back to the farm list", done ? "green" : "orange");
                if (!done && tgt.strongSpots[tgt.cavPlan.monster]) tgt.crowdedUntil[tgt.cavPlan.monster] = Math.max(cavalryNext(), now + 30 * 60 * 1000); // try again with the next Cavalry
                if (done && tgt.cavPlan.mode === "reset") {
                    if (tgt.cavPlan.spot) delete tgt.strongSpotUntil[tgt.spotKey(tgt.cavPlan.spot)];
                    delete tgt.crowdedUntil[tgt.cavPlan.monster];
                    delete tgt.crowdHistory[tgt.cavPlan.monster];
                    if (tgt.strongSpots[tgt.cavPlan.monster]) { delete tgt.strongSpots[tgt.cavPlan.monster]; tgt.saveStrong(); }
                    try { set(CROWD_KEY, tgt.crowdHistory); } catch (e) { /* storage unavailable */ }
                    // A death block goes too (player decision 2026-11-19): the reset spot is fresh.
                    if (tgt.experience[tgt.cavPlan.monster] && tgt.experience[tgt.cavPlan.monster].bad) { delete tgt.experience[tgt.cavPlan.monster].bad; tgt.saveExperience(); }
                }
                tgt.cavPlan = null;
                tgt.nextPickAt = 0;
                return null;
            }
            return { monster: tgt.cavPlan.monster, source: "cavalry " + tgt.cavPlan.mode, map: tgt.cavPlan.spot ? tgt.cavPlan.spot.map : undefined };
        }
        if (!cavalryReady()) return null;
        // An open hunt held back only by too-strong spots (player decision 2026-11-22): the Cavalry resets the spot
        // that the team could take with fresh level-1 monsters, then the hunt is done there.
        for (const m of huntsBlocked) {
            if (tgt.recentDeath(m)) continue;
            const spot = huntResetSpot(m);
            if (!spot) continue;
            tgt.cavPlan = { monster: m, mode: "reset", since: now, spot: spot, hunt: true };
            util.log("target", "Cavalry ready: reset at the " + m + " spot " + spot.map + " " + spot.x + "," + spot.y + " for the hunt (" + spot.why + ")", "yellow");
            return { monster: m, source: "cavalry reset", map: spot.map };
        }
        if (!list.length) {
            // Guide list: the best too-strong spot that ranks above where we farm now.
            const rank = tgt.teamXpRanking() || [];
            const cur = tgt.farm ? rank.indexOf(tgt.farm.monster) : -1;
            const m = rank.find(function (x) { return tgt.strongSpots[x] && !tgt.allSpotsTaken(x, true) && !tgt.recentDeath(x) && !(tgt.noResetUntil[x] > now); });
            if (m && (cur === -1 || rank.indexOf(m) < cur)) tgt.cavPlan = { monster: m, mode: "reset", since: now };
            if (tgt.cavPlan) util.log("target", "Cavalry ready: reset at " + tgt.cavPlan.monster + " (too strong before)", "yellow");
            return tgt.cavPlan ? { monster: tgt.cavPlan.monster, source: "cavalry " + tgt.cavPlan.mode } : null;
        }
        // The first target skipped as too strong OR closed by a death (player decision 2026-11-19):
        // the Cavalry resets it, then it is farmed again.
        if ((tgt.crowdedUntil[list[0]] > now || tgt.recentDeath(list[0])) && !tgt.allSpotsTaken(list[0], true) && !(tgt.noResetUntil[list[0]] > now)) tgt.cavPlan = { monster: list[0], mode: "reset", since: now };
        // Nuke only while we actually farm the first target (fighting there within the last
        // minute) - arriving at grown booboos must lead to their reset, not to the dinos.
        else if (!tgt.farmBlocked(list[0]) && tgt.farm && tgt.farm.monster === list[0] && now - tgt.lastFoundAt < 60 * 1000) {
            const t = (cv.targets || []).find(function (m) { return G.monsters[m] && !tgt.recentDeath(m) && !tgt.allSpotsTaken(m, true); });
            if (t) tgt.cavPlan = { monster: t, mode: "nuke", since: now };
        }
        if (tgt.cavPlan) util.log("target", "Cavalry ready: " + tgt.cavPlan.mode + " at " + tgt.cavPlan.monster, "yellow");
        return tgt.cavPlan ? { monster: tgt.cavPlan.monster, source: "cavalry " + tgt.cavPlan.mode } : null;
    }

    Object.assign(tgt, {
        cavalryNext: cavalryNext,
        cavalryReady: cavalryReady,
        cavalryCalledAt: cavalryCalledAt,
        huntResetSpot: huntResetSpot,
        cavalryEdge: cavalryEdge,
        cavalryPlan: cavalryPlan,
    });
};
