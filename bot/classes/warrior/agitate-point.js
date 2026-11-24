// =====================================================================
// classes/warrior/agitate-point.js - where to Agitate from: splash radius and neighbours, putting on the splash weapons, the best pull point, clear of other kinds, toward the spot middle.
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

    // The splash radius we have - or, with our usual weapons ("swords"), the one the splash
    // weapons in the bag would give: the neighbour count then says what splash would have hit.
    function splashRadius() {
        if (game.me().explosion) return game.me().explosion / 3.6;
        let sum = 0;
        w.splashWeapons().slice(0, 2).forEach(function (x) {
            try { sum += game.itemProps(x.it).explosion || 0; } catch (e) { sum += game.data().items[x.it.name].explosion || 0; }
        });
        return sum / 3.6;
    }
    function splashNeighbours(t, list) {
        const r = splashRadius();
        return list.filter(function (m) { return m !== t && w.edge(m, t) < r; }).length;
    }

    async function putOnSplash() {
        if (w.travelling()) return; // never on the way (see dropSplashOnTheWay)
        w.pack.busy = true;
        try {
            deps.gear.holdWeapons(ag.holdMs || 10 * 60 * 1000);
            // Both maces in ONE equip_batch call (v1.223.6, player request): before, the mainhand went on, the warrior
            // waited for the server, and only then the offhand. Each swapped-out weapon lands on its mace's bag slot,
            // so the second index stays valid.
            const maces = w.splashWeapons(); // "w" in the old single file - renamed: w is the warrior's shared state here
            const off = game.me().slots && game.me().slots.offhand;
            const batch = [];
            if (maces[0]) batch.push({ num: maces[0].num, slot: "mainhand" });
            if (maces[1] && (!off || game.data().items[off.name].type === "weapon")) batch.push({ num: maces[1].num, slot: "offhand" });
            if (batch.length) await deps.gear.equipBatch(batch);
            util.log("warrior", "splash weapons on: " + ["mainhand", "offhand"].map(function (s) {
                const i = game.me().slots[s]; return i ? i.name + " +" + (i.level || 0) : "-";
            }).join(", ") + " (splash radius " + Math.round(splashRadius()) + " px)", "yellow");
        } catch (e) {
            util.log("warrior", "splash weapons: " + util.errReason(e), "orange");
        } finally {
            w.pack.busy = false;
        }
    }

    // The point to Agitate from (player idea 2026-11-18): as many free pack monsters within
    // reach as possible, no unwanted one in reach, then the shortest walk - so we only go as
    // far into the pack as needed. Candidates on a grid around us (agitate.searchRadius,
    // gridStep), reachable in a straight line. { x, y, count, here } or null below minPack.
    function bestPullPoint() {
        const reach = game.data().skills.agitate.range - 10; // centre distance, a little inside the edge-to-edge 320
        const search = ag.searchRadius || 200, grid = ag.gridStep || 40;
        const me = util.xy(game.me());
        const pool = w.packAround(reach + search).map(util.xy);
        if (pool.length < (ag.minPack || 3)) return null;
        const bad = w.unwantedAround(reach + search + 40).map(util.xy);
        let best = null;
        for (let gx = -search; gx <= search; gx += grid) {
            for (let gy = -search; gy <= search; gy += grid) {
                const d = Math.hypot(gx, gy);
                if (d > search) continue;
                const x = me.x + gx, y = me.y + gy;
                const dists = pool.map(function (p) { return Math.hypot(p.x - x, p.y - y); }).filter(function (v) { return v <= reach; });
                const count = dists.length;
                if (count < (ag.minPack || 3)) continue;
                // Count against the average way of the pulled monsters (player decision 2026-11-18:
                // short, even ways so they arrive together, weighted more than one more monster):
                // one monster more is worth agitate.avgPerMonster px less average way. Our own walk
                // only breaks ties.
                const avg = dists.reduce(function (s, v) { return s + v; }, 0) / count;
                const score = count - avg / (ag.avgPerMonster || 60);
                if (best && (score < best.score - 0.02 || (Math.abs(score - best.score) <= 0.02 && d >= best.d))) continue;
                if (bad.some(function (p) { return Math.hypot(p.x - x, p.y - y) <= reach + 20; })) continue;
                if (foreignInReach({ x: x, y: y }).length) continue; // other kinds busy with someone count too (2026-11-23)
                if (d > 0 && !game.canMoveTo(x, y)) continue; // checked last: the costly one
                best = { x: x, y: y, count: count, d: d, avg: avg, score: score };
            }
        }
        if (best) best.here = best.d <= (ag.centerWithin || 20);
        return best;
    }

    // ---- clear of other kinds before Agitate (2026-11-23, player decision) ---------------------
    // Agitate taunts every monster in reach. Fire Spirits (84k HP, 280 px reach, burn) roam into the Giant Scorpion area
    // by themselves; Agitate took them along with the scorpions and the warrior died (five times on 2026-11-22/23, at
    // 03:12 with two of them). Server rule (node/server.js): a monster without rage attacks a passer-by in front of it but
    // never takes up the chase - only a taunt, Agitate or our own hit makes it follow. So before every Agitate no monster
    // of another kind may be within reach: live entities, not spawn boxes (they roam). With one there the warrior first
    // walks to a point clear of all of them (reach + agitate.clearMargin, centre distance - the server measures hitbox to
    // hitbox) that keeps as many of our monsters in reach as possible: the ones on allies first, then the free ones.
    // No such point within agitate.clearSearch: no Agitate (Taunt and the normal combat go on).
    // "Our" kinds: the farm target (event types count) and, in auto mode, the kinds that pass the same safety check
    // (packWanted - the plain snakes with the O-Snakes, 2026-11-18); strict (the protective Agitate, player decision
    // 2026-11-22): the farm kind only. Ones already on us don't count (they come anyway).
    function ourKind(e, strict) {
        let fm = null;
        try { fm = deps.targeting.farmNow ? deps.targeting.farmNow() : null; } catch (x) { fm = null; }
        if (!fm) return true; // no farm target known: as before
        if (fm.any) return !Array.isArray(fm.types) || fm.types.includes(e.mtype);
        return e.mtype === fm.monster || (!strict && w.packWanted(e));
    }
    function foreignInReach(p, list, strict) {
        const r = game.data().skills.agitate.range + (ag.clearMargin || 80);
        return (list || Object.values(game.entities())).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || e.target === game.me().name || ourKind(e, strict)) return false;
            const q = util.xy(e);
            return Math.hypot(q.x - p.x, q.y - p.y) <= r;
        });
    }
    // Toward the spot's middle (2026-11-23, player decision, part 1): we come to most spots from one side, the priest
    // stands on that side and his Absorb Sins (luck catch) pulls the pack outward; Agitate cast where the warrior stood
    // pulled it further out every time - at the Giant Scorpions south into the Fire Spirits. So before an Agitate the
    // warrior standing more than agitate.homeSlack px from the middle of the farm kind's spawn box he is at first walks
    // (at most homeStep px) to a point nearer the middle - the monsters then come to him there: the priest pulls the
    // pack outward, the warrior pulls it back onto the spot. The monsters on allies that are in reach now stay in reach,
    // the point is clear of other kinds, on the leash and outside failing rage zones; it must be homeMinGain px nearer.
    // No such point: Agitate where he stands. (Part 2, drifting toward the middle during the fight: not built.)
    function spotMiddle() {
        let fm = null;
        try { fm = deps.targeting.farmNow ? deps.targeting.farmNow() : null; } catch (x) { fm = null; }
        if (!fm || fm.any || !fm.monster) return null;
        const me = util.xy(game.me());
        let best = null, bestD = Infinity;
        ((game.data().maps[game.me().map] || {}).monsters || []).forEach(function (pk) {
            if (pk.type !== fm.monster) return;
            util.spawnBoxes(pk, game.me().map).forEach(function (b) {
                if (!b || b.length < 4) return;
                const gap = Math.hypot(Math.max(b[0] - me.x, 0, me.x - b[2]), Math.max(b[1] - me.y, 0, me.y - b[3]));
                if (gap < bestD) { bestD = gap; best = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 }; }
            });
        });
        return best && bestD <= (ag.homeNear || 600) ? best : null; // only at the spot, not on the way
    }
    // The point to Agitate from. opts: strict (farm kind only), mid (spot middle or null), keepMust (the monsters on allies
    // in reach now must all stay in reach), maxD (walk limit). Score: monsters on allies first, then nearness to the
    // middle (agitate.homePxPerMonster px nearer = one free monster more), then free ones, then the walk.
    function agitatePoint(must, free, opts) {
        const strict = opts.strict, mid = opts.mid;
        const reach = game.data().skills.agitate.range - 10;
        const search = Math.min(opts.maxD || ag.clearSearch || 240, ag.clearSearch || 240), grid = ag.gridStep || 40;
        const me = util.xy(game.me());
        const foreign = Object.values(game.entities()).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target !== game.me().name && !ourKind(e, strict);
        });
        const mustP = must.map(util.xy), freeP = free.map(util.xy);
        const mustNow = mustP.filter(function (q) { return Math.hypot(q.x - me.x, q.y - me.y) <= reach; }).length;
        const lead = deps.party.enabled && deps.party.isMember && !deps.party.detached() ? deps.party.leaderInfo() : null;
        const leash = (deps.config.party && deps.config.party.leash) || 300;
        const perPx = ag.homePxPerMonster || 40;
        let best = null;
        for (let gx = -search; gx <= search; gx += grid) {
            for (let gy = -search; gy <= search; gy += grid) {
                const d = Math.hypot(gx, gy);
                if (d > search || d === 0) continue;
                const x = me.x + gx, y = me.y + gy;
                const inR = function (q) { return Math.hypot(q.x - x, q.y - y) <= reach; };
                const nMust = mustP.filter(inR).length, nFree = freeP.filter(inR).length;
                if (!nMust && !nFree) continue;
                if (opts.keepMust && nMust < mustNow) continue;
                const dMid = mid ? Math.hypot(mid.x - x, mid.y - y) : 0;
                const score = nMust * 100 + nFree - dMid / perPx - d / (ag.avgPerMonster || 60);
                if (best && score <= best.score) continue;
                if (foreignInReach({ x: x, y: y }, foreign, strict).length) continue;
                if (deps.targeting.failingZoneAt && deps.targeting.failingZoneAt({ x: x, y: y })) continue;
                if (lead && lead.map === game.me().map && Math.hypot(lead.x - x, lead.y - y) > leash) continue;
                if (!game.canMoveTo(x, y)) continue; // checked last: the costly one
                best = { x: x, y: y, d: d, dMid: dMid, must: nMust, free: nFree, of: must.length, score: score };
            }
        }
        return best;
    }
    // "go": Agitate now; "step": walking to a better point first (this tick is taken); "no": no Agitate.
    let clearWalk = null, clearLogAt = 0, homeLogAt = 0;
    function agitateClear(must, free, strict) {
        must = must || []; free = free || [];
        // Never with a Giga Crab in reach (events.noArea, 2026-11-23): Agitate would take it off its player onto us.
        if (util.noAreaNear(deps.config, game.data().skills.agitate.range + (ag.clearMargin || 80))) { util.status("agitate: Giga Crab in reach", "white"); return "no"; }
        const me = util.xy(game.me());
        const here = foreignInReach(me, null, strict);
        const logNow = Date.now() - clearLogAt > 60 * 1000;
        const mid = ag.home === false ? null : spotMiddle();
        const dMidNow = mid ? Math.hypot(mid.x - me.x, mid.y - me.y) : 0;
        let p = null, why = null;
        if (here.length) {
            const kinds = {};
            here.forEach(function (e) { kinds[e.mtype] = (kinds[e.mtype] || 0) + 1; });
            const what = Object.keys(kinds).map(function (k) { return kinds[k] + "x " + k; }).join(", ");
            p = agitatePoint(must, free, { strict: strict, mid: mid });
            if (!p) {
                if (logNow) { clearLogAt = Date.now(); util.log("warrior", "agitate: " + what + " in reach, no clear point - no Agitate", "orange"); }
                util.status("agitate: " + what + " in reach", "white");
                return "no";
            }
            if (logNow) {
                clearLogAt = Date.now();
                util.log("warrior", "agitate: " + what + " in reach - stepping " + Math.round(p.d) + " px clear first (" +
                    p.must + "/" + p.of + " on allies and " + p.free + " free ones stay in reach" + (mid ? ", " + Math.round(p.dMid) + " px from the spot middle" : "") + ")", "yellow");
            }
            why = "clear of " + Object.keys(kinds)[0];
        } else if (mid && dMidNow > (ag.homeSlack || 100)) {
            p = agitatePoint(must, free, { strict: strict, mid: mid, keepMust: true, maxD: ag.homeStep || 160 });
            if (!p || p.dMid > dMidNow - (ag.homeMinGain || 40)) { clearWalk = null; return "go"; } // nothing better: here
            if (Date.now() - homeLogAt > 60 * 1000) {
                homeLogAt = Date.now();
                util.log("warrior", "agitate: " + Math.round(dMidNow) + " px from the spot middle - stepping " + Math.round(p.d) + " px toward it first (" +
                    p.must + "/" + p.of + " on allies and " + p.free + " free ones stay in reach, then " + Math.round(p.dMid) + " px)", "white");
            }
            why = "toward the spot middle";
        } else { clearWalk = null; return "go"; }
        if (!game.isMoving(game.me()) || !clearWalk || Math.hypot(clearWalk.x - p.x, clearWalk.y - p.y) > 25) {
            clearWalk = { x: p.x, y: p.y };
            quiet(game.walkStraight(p.x, p.y));
        }
        util.status("agitate: stepping " + why, "orange");
        return "step";
    }

    Object.assign(w, {
        splashRadius: splashRadius,
        splashNeighbours: splashNeighbours,
        putOnSplash: putOnSplash,
        bestPullPoint: bestPullPoint,
        ourKind: ourKind,
        foreignInReach: foreignInReach,
        spotMiddle: spotMiddle,
        agitatePoint: agitatePoint,
        agitateClear: agitateClear,
    });
};
