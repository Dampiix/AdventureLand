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

    // The guide plans kill times for the leader alone; the team is faster (config.hunts.teamSpeedup).
    function teamCycle(route) {
        return util.teamCycle(route, config.hunts && config.hunts.teamSpeedup);
    }

    function isBoss(monster) {
        const m = G.monsters[monster];
        return !!m && ((((config.events || {}).search) || []).includes(monster) || m.respawn > 200 || !!m.cooperative);
    }

    // Base XP per second of a route (monster XP / kill cycle). The guide's own route "xp"
    // rated crabs at 5663 vs crocs at 620 on 2026-11-17 - in practice crabs give little.
    function xpRate(route) {
        const m = G.monsters[route.monster];
        return m && route.cycle > 0 ? (m.xp || 0) / route.cycle : 0;
    }

    // Solo with Lone Wolf the bonus loot roll scales with our (full) contribution and the
    // extra luck: our own table estimates count that in. Party shares vary – no bonus there.
    function luckFactor() {
        if (ctx.party && ctx.party.enabled) return 1;
        const t = character.encouragement && character.encouragement.totals;
        return t && t.luck > 1 ? t.luck : 1;
    }

    // Every farm route for one missing item, fastest first ([] = none): the guide's routes
    // plus our own from the drop tables – so a crowded best spot falls back to the next one
    // (stat rings: ice roamers full of bots -> arctic bees on the same map, 2026-11-17).
    function routeFor(need) {
        let advice;
        try {
            advice = get_progression({ goal: { kind: "item", name: need.name, level: 0, quantity: need.copies } });
        } catch (e) {
            util.log("drops", "guide failed for " + need.name + ": " + util.errReason(e), "red");
            return null;
        }
        const list = [];
        const consider = function (a) {
            if (!a || a.kind !== "farm" || !a.route || a.blocked || !G.monsters[a.route.monster]) return;
            // The guide's plain XP row (no item, no rate) says nothing about this drop.
            if (!(a.rate > 0) && !(a.meanSeconds > 0)) return;
            // Seconds per copy: the team's kill cycle divided by the drop rate (guide's own
            // numbers; one roll per kill, however many of us hit it).
            const cycle = teamCycle(a.route);
            const perCopy = a.rate > 0 && cycle
                ? cycle / a.rate
                : a.meanSeconds * (cycle && a.route.cycle > 0 ? cycle / a.route.cycle : 1) / Math.max(1, need.copies);
            list.push({ monster: a.route.monster, map: a.route.map, perCopy: perCopy, xp: xpRate(a.route) });
        };
        (advice && advice.rows || []).forEach(function (row) {
            consider(row.action);
            const tree = row.plan && row.plan.tree;
            if (tree) (tree.alternatives || []).forEach(consider);
        });
        // The guide has no drop route for some items (e.g. a Cape from 40 Leather, books when
        // it counts other copies, map drops on other monsters): the game's drop tables.
        tableRoutes(need.name).forEach(function (r) { list.push(r); });
        const seen = {};
        return list.sort(function (a, b) { return a.perCopy - b.perCopy; }).filter(function (r) {
            // Bosses (searched by bot_events, or a respawn over 200 s like Dracul) are no farm
            // spot: the team would stand at an empty spawn for 13-22 min (2026-11-17).
            if (isBoss(r.monster)) return false;
            const k = r.monster + "@" + r.map;
            if (seen[k]) return false;
            seen[k] = true;
            return true;
        });
    }

    // Per-kill chance of `name` from every monster on a map (G.drops.maps: map-wide drops,
    // directly or through a table such as statring). { map: rate }
    function mapDropRates(name) {
        const rates = {};
        const maps = (G.drops && G.drops.maps) || {};
        Object.keys(maps).forEach(function (map) {
            (maps[map] || []).forEach(function (d) {
                if (!Array.isArray(d) || !(d[0] > 0)) return;
                let share = 0;
                if (d[1] === name) share = 1;
                else if (d[1] === "open" && Array.isArray(G.drops[d[2]])) {
                    const table = G.drops[d[2]];
                    const total = table.reduce(function (s, x) { return s + (x && x[0] > 0 ? x[0] : 0); }, 0);
                    const weight = table.reduce(function (s, x) { return s + (x && x[1] === name ? x[0] : 0); }, 0);
                    if (total > 0) share = weight / total;
                }
                if (share > 0) rates[map] = (rates[map] || 0) + d[0] * share;
            });
        });
        return rates;
    }

    // Per-kill chance of `name` from each monster: direct drops plus one exchange step
    // (e.g. 40 Leather -> Cape with 20 of 21.5 weight). { monster: rate }
    function dropRates(name) {
        const rates = {};
        const add = function (monster, rate) { if (rate > 0) rates[monster] = (rates[monster] || 0) + rate; };
        const monsters = (G.drops && G.drops.monsters) || {};
        const perKill = function (item) {
            const out = {};
            Object.keys(monsters).forEach(function (m) {
                (monsters[m] || []).forEach(function (d) {
                    if (d && d[1] === item) out[m] = (out[m] || 0) + d[0] * (typeof d[2] === "number" ? d[2] : 1);
                });
            });
            return out;
        };
        const direct = perKill(name);
        Object.keys(direct).forEach(function (m) { add(m, direct[m]); });
        Object.keys(G.drops || {}).forEach(function (source) {
            const table = G.drops[source];
            const def = G.items[source];
            if (!Array.isArray(table) || !def || !def.e) return;
            const total = table.reduce(function (s, d) { return s + (d && d[0] > 0 ? d[0] : 0); }, 0);
            const weight = table.reduce(function (s, d) { return s + (d && d[1] === name ? d[0] : 0); }, 0);
            if (!(total > 0) || !(weight > 0)) return;
            const share = weight / total / def.e;
            const from = perKill(source);
            Object.keys(from).forEach(function (m) { add(m, from[m] * share); });
        });
        return rates;
    }

    // Safe guide routes among the monsters that drop `name` (own or map drops), fastest first.
    function tableRoutes(name) {
        const rates = dropRates(name);
        const mapRates = mapDropRates(name);
        if (!Object.keys(rates).length && !Object.keys(mapRates).length) return [];
        let routesNow = [];
        try { routesNow = (get_progression() || {}).routes || []; } catch (e) { return []; }
        const luck = luckFactor();
        // Same safety rule as any farm target: safe for every member, trials only once proven.
        const teamSafe = function (m) { return !ctx.targeting || ctx.targeting.isTeamSafe(m); };
        const out = [];
        routesNow.forEach(function (r) {
            if (!r) return;
            const rate = ((rates[r.monster] || 0) + (mapRates[r.map] || 0)) * luck;
            // The guide's own "safe" (for the leader alone) is not needed once the team model judges spots.
            const teamModel = ctx.targeting && ctx.targeting.teamModelOn && ctx.targeting.teamModelOn();
            if (!(rate > 0) || !(r.cycle > 0) || (r.safe !== true && !teamModel) || !teamSafe(r.monster)) return;
            out.push({ monster: r.monster, map: r.map, perCopy: teamCycle(r) / rate, xp: xpRate(r) });
        });
        return out.sort(function (a, b) { return a.perCopy - b.perCopy; });
    }

    // Stage 3 (player decision 2026-11-19): the merchant's wish values - { xpTeam, items: { name: [
    // { gain, goldH, copies, wish }] } } - decide between the XP spot and drop spots.
    let values = null, valuesAt = 0;
    comms.on("values", function (data, from) {
        if (from !== config.merchant) return;
        values = data;
        valuesAt = Date.now();
        nextCheckAt = 0;
    });

    // Value report (stage 1): the merchant asks for per-copy farm times of the items its wishes
    // need, whether or not we farm for drops. One guide query per item, cached for 30 min.
    const timeCache = {}; // name -> { at, perCopy }
    comms.on("timesfor", function (data, from) {
        if (from !== config.merchant || !leads) return;
        const times = {};
        (data.list || []).slice(0, 15).forEach(function (name) {
            if (!G.items[name]) return;
            const c = timeCache[name];
            if (c && Date.now() - c.at < 30 * 60 * 1000) { if (c.perCopy) times[name] = c.perCopy; return; }
            const cands = routeFor({ name: name, copies: 1 }) || [];
            const best = cands[0] && isFinite(cands[0].perCopy) ? Math.round(cands[0].perCopy) : null;
            timeCache[name] = { at: Date.now(), perCopy: best };
            if (best) times[name] = best;
        });
        comms.send(config.merchant, "droptimes", { times: times });
    });

    function check() {
        nextCheckAt = Date.now() + cfg.refreshMs;
        // Merchant reports older than an hour are stale (merchant gone); it reports every
        // few minutes, but long trips or upgrade runs can delay a report.
        if (Date.now() - needsAt > 60 * 60 * 1000) needs = [];
        const limit = cfg.maxHoursPerCopy * 3600;
        const found = [];
        const times = {}; // item -> seconds per copy on its best safe route (value report)
        const list = needs.slice();
        if (cfg.byValue && values && values.items) Object.keys(values.items).forEach(function (n) {
            if (!G.items[n] || list.some(function (x) { return x.name === n; })) return;
            const copies = values.items[n].reduce(function (m, w) { return Math.max(m, w.copies || 0); }, 0);
            if (copies > 0) list.push({ name: n, copies: Math.ceil(copies) });
        });
        list.forEach(function (need) {
            const cands = routeFor(need);
            const r = cands[0];
            if (r && isFinite(r.perCopy)) times[need.name] = Math.round(r.perCopy);
            if (!r) {
                if (Date.now() - (slowLogged[need.name] || 0) < 60 * 60 * 1000) return;
                slowLogged[need.name] = Date.now();
                util.log("drops", need.name + ": no safe spot drops it yet - not farming it", "white");
                return;
            }
            if (r.perCopy > limit) {
                if (Date.now() - (slowLogged[need.name] || 0) < 60 * 60 * 1000) return;
                slowLogged[need.name] = Date.now();
                // Lottery chains (e.g. a belt from a Glitch from xscorpions) give absurd numbers.
                const est = r.perCopy > 1000 * 3600 ? "practically never (over 1000 h per copy)" : "~" + hours(r.perCopy) + " per copy";
                util.log("drops", need.name + ": " + est + " at " + r.monster + " - too slow, not farming it", "white");
                return;
            }
            cands.filter(function (c) { return c.perCopy <= limit; }).forEach(function (c) {
                found.push(Object.assign({ name: need.name, copies: need.copies }, c));
            });
        });
        // Every route here is fast enough (maxHoursPerCopy): take the one with the best XP,
        // not the fastest copy – a map drop (HP belts on the main map) sent the solo warrior
        // to the crabs (quickest kills, a third of the XP) instead of the crocs (2026-11-17).
        // Crowded spots are skipped by target(), so the next one follows.
        routes = found.sort(function (a, b) { return (b.xp || 0) - (a.xp || 0) || a.perCopy - b.perCopy; });
        if (config.merchant && Object.keys(times).length) comms.send(config.merchant, "droptimes", { times: times });
    }

    function hours(seconds) {
        return seconds < 3600 ? Math.round(seconds / 60) + " min" : (seconds / 3600).toFixed(1) + " h";
    }

    // Leader: the drop route to farm now, or null. isCrowded(monster) skips busy spots.
    // Stage 3: power per hour of each drop spot (the team's XP value scaled by the spot's XP rate,
    // plus the best wish per needed item that drops there) against the best XP spot.
    let lastValueLog = 0, lastValueKey = "";
    function valuePick(isCrowded) {
        const items = values.items || {};
        let ref = 0;
        try {
            ((get_progression() || {}).routes || []).forEach(function (r) {
                if (!r || !(r.cycle > 0) || !G.monsters[r.monster] || isBoss(r.monster)) return;
                if (ctx.targeting && !ctx.targeting.isTeamSafe(r.monster)) return;
                ref = Math.max(ref, xpRate(r));
            });
        } catch (e) { /* guide not ready */ }
        const kXp = ref > 0 ? (values.xpTeam || 0) / ref : 0;
        const spots = {};
        routes.forEach(function (r) {
            if (isCrowded(r.monster)) return;
            const o = spots[r.monster] = spots[r.monster] || { monster: r.monster, map: r.map, xp: r.xp || 0, gear: {}, name: r.name, copies: r.copies, perCopy: r.perCopy };
            const best = (items[r.name] || []).reduce(function (m, w) {
                return Math.max(m, w.gain / Math.max(0.01, (w.goldH || 0) + (w.copies || 0) * r.perCopy / 3600));
            }, 0);
            if (best > (o.gear[r.name] || 0)) o.gear[r.name] = best;
        });
        let best = null;
        Object.keys(spots).forEach(function (k) {
            const o = spots[k];
            o.gearValue = Object.keys(o.gear).reduce(function (s, n) { return s + o.gear[n]; }, 0);
            o.total = kXp * o.xp + o.gearValue;
            if (!best || o.total > best.total) best = o;
        });
        const xpTotal = kXp * ref;
        const current = lastPick ? spots[lastPick.split("@")[1]] : null;
        const need = current && best && current.monster === best.monster ? 1 : (cfg.valueSwitch || 1.2);
        const go = best && best.gearValue > 0 && best.total > xpTotal * need;
        const r2 = function (x) { return Math.round(x * 100) / 100; };
        const key = go ? best.monster : "xp";
        if (key !== lastValueKey || Date.now() - lastValueLog > 30 * 60 * 1000) {
            lastValueKey = key;
            lastValueLog = Date.now();
            util.log("drops", "value: XP spot " + r2(xpTotal) + "%/h" + (best ? " vs " + best.monster + " " + r2(best.total) + "%/h (XP " + r2(kXp * best.xp) + " + gear " + r2(best.gearValue) + ": " + Object.keys(best.gear).join(", ") + ")" : " - no drop spot") + " -> " + (go ? best.monster : "XP"), "white");
        }
        if (!go) return null;
        const names = Object.keys(best.gear).sort(function (a, b) { return best.gear[b] - best.gear[a]; });
        return routes.find(function (r) { return r.monster === best.monster && r.name === names[0]; }) || null;
    }

    function target(isCrowded) {
        if (!cfg.enabled || !leads) return null;
        if (Date.now() >= nextCheckAt) check();
        // By value without values (right after a restart): the XP spot, not the old "any drop
        // faster than maxHoursPerCopy" rule (2026-11-19: it sent the team to the arctic bees for
        // STR rings at 3.3 h per copy).
        if (cfg.byValue && !(values && Date.now() - valuesAt < 60 * 60 * 1000)) { lastPick = ""; return null; }
        if (cfg.byValue && values && Date.now() - valuesAt < 60 * 60 * 1000) {
            const vp = valuePick(isCrowded);
            if (!vp) {
                if (lastPick) util.log("drops", "back to the XP spot (worth more now)", "white");
                lastPick = "";
                return null;
            }
            const vid = vp.name + "@" + vp.monster;
            if (vid !== lastPick) {
                lastPick = vid;
                util.log("drops", "farming " + vp.monster + " for " + G.items[vp.name].name + " (worth more than XP now, ~" + hours(vp.perCopy) + " per copy)", "yellow");
            }
            return { monster: vp.monster, map: vp.map, source: "drop " + vp.name };
        }
        let pick = routes.find(function (r) { return !isCrowded(r.monster); });
        // Stay on the current drop spot while it is nearly as good (within 15 % XP): the
        // guide flips spots like poisios between trial and safe, and every flip walked the
        // warrior between crocs and poisios (2026-11-17).
        const stay = pick && routes.find(function (r) { return r.name + "@" + r.monster === lastPick && !isCrowded(r.monster); });
        if (stay && (stay.xp || 0) >= (pick.xp || 0) * 0.85) pick = stay;
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
