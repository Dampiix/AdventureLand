// =====================================================================
// combat/cavalry.js - the Cavalry: walking to a grown pack and calling it, guarded calls, the account-wide cooldown.
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
    const CAV_KEY = "bot_cavalry_next";

    function cavalryReady() {
        let next = 0;
        try { next = get(CAV_KEY) || 0; } catch (e) { /* storage unavailable */ }
        return Date.now() >= next && Date.now() >= ftr.cavTryAt;
    }
    function callCavalry(why) {
        ftr.cavTryAt = Date.now() + 60 * 1000; // one try per minute at most
        util.log("cavalry", "calling the Cavalry: " + why, "yellow");
        interact("cavalry").then(function (r) {
            const wait = (r && (r.cooldown_ms || (r.next_call ? new Date(r.next_call).getTime() - Date.now() : 0))) || 0;
            try { set(CAV_KEY, Date.now() + Math.max(wait, 10 * 60 * 1000)); set("bot_cavalry_called", Date.now()); } catch (e) { /* storage unavailable */ }
            util.log("cavalry", "Cavalry answered (" + ((r && r.assigned) || 0) + " sentries" + (r && r.queued ? ", queued" : "") + ")", "green");
        }).catch(function (e) {
            const ms = e && (e.cooldown_ms || e.ms);
            if (ms) try { set(CAV_KEY, Date.now() + ms); } catch (x) { /* storage unavailable */ }
            util.log("cavalry", "Cavalry refused: " + util.errReason(e), "orange");
        });
    }
    // Reset/nuke guard (player decision 2026-11-21). At 09:14Z the Cavalry was called on 2 grown
    // booboos (levels 19,10) while other players fought more of them in reach: the sentries hit
    // every level-3+ monster within 320 px, those came for us, and the warrior and the ranger
    // died within 11 s. So a reset or nuke call needs
    //   - nothing in reach fought by players outside our team (it pulls their monsters on us and
    //     takes their kills), and
    //   - the team surviving everything the Cavalry would take at once: the same check as a pack
    //     we farm (team model as leader, our own hits and sustain solo), per kind, with the
    //     strongest one of the kind and the count in reach.
    // Emergency calls are not checked: there the monsters are on us already.
    // Returns null when the call is fine, else why not.
    function cavalryBlock(list) {
        const ours = function (n) { return n === character.name || party.inParty(n) || (config.team.fighters || []).includes(n); };
        const fought = list.filter(function (e) { return e.target && !ours(e.target); });
        if (fought.length) {
            const who = fought.map(function (e) { return e.target; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
            return fought.length + " of them fought by " + who.join(", ");
        }
        const byType = {};
        list.forEach(function (e) { (byType[e.mtype] = byType[e.mtype] || []).push(e); });
        // Our own farm monster needs no HP check (player decision 2026-11-21): the sentries kill them,
        // not we - the pack check blocked every reset of 4-9 level-26 CGoos in the arena while the
        // warrior just stood there. The players check above and foreignClear stay.
        const own = ftr.lastFarm && ftr.lastFarm.monster;
        for (const type of Object.keys(byType)) {
            if (type === own) continue;
            const pack = byType[type];
            const live = pack.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0); })[0];
            const v = targeting.teamModelOn() ? targeting.teamVerdict(type, live, { pull: pack.length }) : targeting.packVerdict(live, pack.length);
            if (!v.ok) return pack.length + "x " + type + " at once: " + (v.why || "unsafe");
        }
        return null;
    }
    function guardedCall(why, inReach) {
        const block = cavalryBlock(inReach);
        if (!block) return callCavalry(why);
        // Logged when the reason changes, else every 5 min.
        if (block !== ftr.cavBlocked.why || Date.now() - ftr.cavBlocked.at > 5 * 60 * 1000) {
            ftr.cavBlocked = { why: block, at: Date.now() };
            util.log("cavalry", "not calling the Cavalry (" + why + "): " + block, "orange");
        }
    }
    function cavalryTick() {
        const cv = config.cavalry || {};
        if (!cv.enabled || character.rip || !cavalryReady()) return;
        if (!["tracker", "supercomputer"].some(function (n) { return util.countItem(n) > 0; })) return;
        const reach = 320;
        const grown = function (e) { return e && e.type === "monster" && !e.dead && (e.level || 1) >= 3 && util.distanceTo(e) <= reach && G.monsters[e.mtype] && !G.monsters[e.mtype].cooperative; };
        const all = Object.values(parent.entities || {});
        // Emergency: low HP with level-3+ monsters on us (only those can be taken).
        if (util.hpRatio() < (cv.emergencyHpBelow || 0.35)) {
            const on = all.filter(function (e) { return grown(e) && e.target === character.name; });
            if (on.length >= (cv.emergencyOnMe || 1)) return callCavalry("emergency, " + Math.round(util.hpRatio() * 100) + "% HP, " + on.length + " on me");
        }
        // Reset/nuke: the Cavalry takes the NEAREST level-3+ monsters of any kind, and one it hits
        // goes for the caller (it never targets the Cavalry). 2026-11-19: a passive green fairy
        // (3,000 magic damage, whole-map reach) near the dinos was taken and killed the priest.
        // So no call while another kind of level-3+ monster is within foreignClear px.
        const foreign = function (type) {
            return all.some(function (e) {
                return e && e.type === "monster" && !e.dead && e.mtype !== type && (e.level || 1) >= 3 &&
                    G.monsters[e.mtype] && !G.monsters[e.mtype].cooperative && util.distanceTo(e) <= (cv.foreignClear || 420);
            });
        };
        // Reset: the spot picker at its farm target, not during events.
        if (deps.events.current() || !ftr.lastFarm || !ftr.lastFarm.monster || ftr.lastFarm.any) return;
        if (foreign(ftr.lastFarm.monster)) return;
        if (party.enabled && party.isMember && !party.detached()) return;
        // Cavalry plan (targeting): nuke = any level-3+ one of the kind in reach; reset = grown ones.
        const src = String(ftr.lastFarm.source || "");
        if (src === "cavalry nuke" || src === "cavalry reset") {
            const lvl = 3; // the plan wants this spot cleared - any level the Cavalry takes
            const these = all.filter(function (e) { return grown(e) && e.mtype === ftr.lastFarm.monster && (e.level || 1) >= lvl; });
            // Most of the pack in reach first (2026-11-19: the call came with 1 mummy in reach and the
            // Cavalry left after killing it): planMinCount of them, or all we see if fewer.
            const seen = all.filter(function (e) { return e && e.type === "monster" && !e.dead && e.mtype === ftr.lastFarm.monster && (e.level || 1) >= lvl; }).length;
            if (these.length && these.length >= Math.min(cv.planMinCount || 5, seen)) guardedCall(src.slice(8) + " " + these.length + "x " + ftr.lastFarm.monster + " (levels " + these.map(function (e) { return e.level || 1; }).join(",") + ")", all.filter(grown));
            return;
        }
        if (!cv.reset) return;
        // At least resetPackMin grown ones in reach, or all we see if fewer (player decision 2026-11-21:
        // a call with 3 of 27 level-26 CGoos in reach spent the ~70 min cooldown on three of them).
        const bigAll = all.filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.mtype === ftr.lastFarm.monster && (e.level || 1) >= (cv.resetFromLevel || 5) &&
                G.monsters[e.mtype] && !G.monsters[e.mtype].cooperative;
        });
        const big = bigAll.filter(function (e) { return util.distanceTo(e) <= reach; });
        const want = Math.max(cv.resetMinCount || 2, Math.min(cv.resetPackMin || 5, bigAll.length));
        const levels = function (l) { return l.map(function (e) { return e.level || 1; }).join(","); };
        // Something on us already: the call goes out at once with what is in reach (they come anyway).
        const onUs = all.some(function (e) { return e && e.type === "monster" && !e.dead && e.target === character.name; });
        if (onUs && big.length >= (cv.resetMinCount || 2)) {
            ftr.cavWalk = null;
            guardedCall("reset " + big.length + "x " + ftr.lastFarm.monster + " (attacked, levels " + levels(big) + ")", all.filter(grown));
            return;
        }
        if (bigAll.length < want || onUs) { ftr.cavWalk = null; return; }
        // The densest group (player decision 2026-11-21): the grown one with the most others within
        // 80 % of the reach, and the middle of that group - we call from there, so the sentries take as
        // many as possible (up to 24) instead of the first 5 at the group's edge.
        let group = [];
        bigAll.forEach(function (e) {
            const p = util.xy(e);
            const g = bigAll.filter(function (o) { const q = util.xy(o); return Math.hypot(q.x - p.x, q.y - p.y) <= reach * 0.8; });
            if (g.length > group.length) group = g;
        });
        let mid = group.reduce(function (s, e) { const q = util.xy(e); return { x: s.x + q.x / group.length, y: s.y + q.y / group.length }; }, { x: 0, y: 0 });
        // Not into a rage zone we can't take (2026-11-22: at 06:43 the walk to the middle of the booboos pulled
        // the whole spawn, the sentries only take level 3+ and the level-1/2 ones killed the warrior): the call
        // goes out from just outside the box, on our side of it.
        const fz = targeting.failingZoneAt ? targeting.failingZoneAt(mid) : null;
        if (fz) {
            const me = util.xy(character);
            const len = Math.hypot(me.x - mid.x, me.y - mid.y) || 1;
            let p = { x: mid.x, y: mid.y };
            for (let d = 0; d <= len && targeting.failingZoneAt(p); d += 20) p = { x: mid.x + (me.x - mid.x) * d / len, y: mid.y + (me.y - mid.y) * d / len };
            mid = { x: p.x + (me.x - mid.x) / len * 40, y: p.y + (me.y - mid.y) / len * 40 };
        }
        const inGroup = group.filter(function (e) { return util.distanceTo(e) <= reach; }).length;
        const atMid = util.distanceTo(mid) <= 40;
        // Stuck on the way (wall, no path) for 3 s: call from here when enough are in reach.
        const stuck = ftr.cavWalk && !is_moving(character) && Date.now() - ftr.cavWalk.at > 3000;
        if (big.length >= want && (atMid || stuck || inGroup >= group.length || big.length >= 24)) {
            ftr.cavWalk = null;
            guardedCall("reset " + big.length + "x " + ftr.lastFarm.monster + " (levels " + levels(big) + ", group of " + group.length + ")", all.filter(grown));
            return;
        }
        const sameMid = ftr.cavWalk && Math.hypot(ftr.cavWalk.x - mid.x, ftr.cavWalk.y - mid.y) <= 60;
        if (!sameMid || (!is_moving(character) && !atMid)) {
            ftr.cavWalk = { x: mid.x, y: mid.y, at: sameMid ? ftr.cavWalk.at : Date.now() }; // "at" survives re-sends (stuck check)
            if (can_move_to(mid.x, mid.y)) move(mid.x, mid.y);
            else smart_move({ map: character.map, x: mid.x, y: mid.y }).catch(function () {});
            if (Date.now() - ftr.cavWalkLog > 60 * 1000) {
                ftr.cavWalkLog = Date.now();
                util.log("cavalry", "walking to the middle of the " + ftr.lastFarm.monster + " group for the Cavalry: " + group.length + " there, " + big.length + " in reach now", "yellow");
            }
        }
        util.status("to the pack (Cavalry)", "yellow");
        return true;
    }

    Object.assign(ftr, {
        cavalryReady: cavalryReady,
        callCavalry: callCavalry,
        cavalryBlock: cavalryBlock,
        guardedCall: guardedCall,
        cavalryTick: cavalryTick,
    });
};
