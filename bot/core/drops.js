// =====================================================================
// bot_drops – farm items that can't be bought (approved 2026-11-15).
//
// The merchant knows what is missing: it counts bag and bank and reports
// shortages (wished rings, books, earrings ... without enough copies, plus
// config.drops.want) to the leader every few minutes.
// The leader asks its progression guide for each missing item
// (get_progression with an item goal): the guide answers with the best safe
// farm route for that drop and the expected time. Items come first: if a
// route needs at most config.drops.maxHoursPerCopy per copy, the team farms
// there (fastest item first) instead of the guide's XP spot. Events, hunts
// and a configured farm target still come first.
// =====================================================================

module.exports = function createDrops(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const cfg = config.drops;
    const leads = !ctx.party || !ctx.party.isMember;

    // [{ name, copies }] from the merchant; kept across restarts so a reload doesn't
    // send the team to the XP spot until the next report arrives.
    const NEEDS_KEY = "dmpx_drop_needs:" + character.name;
    const saved = (function () { try { return get(NEEDS_KEY) || {}; } catch (e) { return {}; } })();
    let needs = saved.list || [];
    let needsAt = saved.at || 0;
    let routes = [];         // [{ name, copies, monster, map, perCopy }] fastest first
    let nextCheckAt = 0;
    let lastPick = "";
    const slowLogged = {};   // item -> last "too slow" log

    comms.on("drops", function (data, from) {
        if (from !== config.merchant) return;
        needs = (data.list || []).filter(function (n) { return n && G.items[n.name] && n.copies > 0; }).slice(0, 8);
        needsAt = Date.now();
        try { set(NEEDS_KEY, { list: needs, at: needsAt }); } catch (e) { /* storage unavailable */ }
        nextCheckAt = 0; // re-evaluate right away
    });

    // The guide's farm advice for one missing item, or null.
    function routeFor(need) {
        let advice;
        try {
            advice = get_progression({ goal: { kind: "item", name: need.name, level: 0, quantity: need.copies } });
        } catch (e) {
            util.log("drops", "guide failed for " + need.name + ": " + util.errReason(e), "red");
            return null;
        }
        let best = null;
        const consider = function (a) {
            if (!a || a.kind !== "farm" || !a.route || a.blocked || !G.monsters[a.route.monster]) return;
            // Seconds per copy: the route's kill cycle divided by the drop rate (guide's own numbers).
            const perCopy = a.rate > 0 && a.route.cycle > 0
                ? a.route.cycle / a.rate
                : (a.meanSeconds || Infinity) / Math.max(1, need.copies);
            if (!best || perCopy < best.perCopy) best = { monster: a.route.monster, map: a.route.map, perCopy: perCopy };
        };
        (advice && advice.rows || []).forEach(function (row) {
            consider(row.action);
            const tree = row.plan && row.plan.tree;
            if (tree) (tree.alternatives || []).forEach(consider);
        });
        return best;
    }

    function check() {
        nextCheckAt = Date.now() + cfg.refreshMs;
        // Merchant reports older than an hour are stale (merchant gone); it reports every
        // few minutes, but long trips or upgrade runs can delay a report.
        if (Date.now() - needsAt > 60 * 60 * 1000) needs = [];
        const limit = cfg.maxHoursPerCopy * 3600;
        const found = [];
        needs.forEach(function (need) {
            const r = routeFor(need);
            if (!r) return;
            if (r.perCopy > limit) {
                if (Date.now() - (slowLogged[need.name] || 0) < 60 * 60 * 1000) return;
                slowLogged[need.name] = Date.now();
                util.log("drops", need.name + ": ~" + hours(r.perCopy) + " per copy at " + r.monster + " - too slow, not farming it", "white");
                return;
            }
            found.push(Object.assign({ name: need.name, copies: need.copies }, r));
        });
        routes = found.sort(function (a, b) { return a.perCopy - b.perCopy; });
    }

    function hours(seconds) {
        return seconds < 3600 ? Math.round(seconds / 60) + " min" : (seconds / 3600).toFixed(1) + " h";
    }

    // Leader: the drop route to farm now, or null. isCrowded(monster) skips busy spots.
    function target(isCrowded) {
        if (!cfg.enabled || !leads) return null;
        if (Date.now() >= nextCheckAt) check();
        const pick = routes.find(function (r) { return !isCrowded(r.monster); });
        if (!pick) {
            if (lastPick) {
                const was = lastPick.split("@");
                const still = routes.some(function (r) { return r.name === was[0]; });
                util.log("drops", (still ? was[1] + " spot is crowded" : G.items[was[0]].name + " no longer needed") + " - back to the guide's farm target", "white");
            }
            lastPick = "";
            return null;
        }
        const id = pick.name + "@" + pick.monster;
        if (id !== lastPick) {
            lastPick = id;
            util.log("drops", "farming " + pick.monster + " for " + G.items[pick.name].name + " (" + pick.copies + " missing, ~" + hours(pick.perCopy) + " per copy)", "yellow");
        }
        return { monster: pick.monster, map: pick.map, source: "drop " + pick.name };
    }

    return { target: target };
};
