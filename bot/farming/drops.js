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
// there (the route with the best XP first; with drops.byValue the spot whose
// XP + gear value per hour beats the XP spot, valuePick) instead of the
// guide's XP spot. Events, hunts
// and a configured farm target still come first.
// =====================================================================

// deps (module plan, stage 7a): { config, util, comms, bus, party, targeting } - targeting is created later (a getter).
module.exports = function createDrops(deps) {
    const config = deps.config;
    const util = deps.util;
    const comms = deps.comms;
    const cfg = config.drops;
    const leads = !deps.party || !deps.party.isMember;

    // [{ name, copies }] from the merchant; kept across restarts so a reload doesn't
    // send the team to the XP spot until the next report arrives.
    const NEEDS_KEY = "bot_drop_needs:" + character.name;
    const saved = (function () { try { return get(NEEDS_KEY) || {}; } catch (e) { return {}; } })();
    let needs = saved.list || [];
    let needsAt = saved.at || 0;
    // The merchant's whole list (needs keeps only the first 8 for the guide's routes): hunts check every entry
    // against the drop table (hunts.dropWorth, 2026-11-23).
    let allNeeds = saved.all || needs.slice();
    let routes = [];         // [{ name, copies, monster, map, perCopy }] best XP first
    let nextCheckAt = 0;
    let lastPick = "";
    const slowLogged = {};   // item -> last "too slow" log

    comms.on("drops", function (data, from) {
        if (from !== config.merchant) return;
        allNeeds = (data.list || []).filter(function (n) { return n && G.items[n.name] && n.copies > 0; });
        needs = allNeeds.slice(0, 8);
        needsAt = Date.now();
        try { set(NEEDS_KEY, { list: needs, all: allNeeds, at: needsAt }); } catch (e) { /* storage unavailable */ }
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

    // Luck on the drop chance (v1.227.0, player decision 2026-11-23; server: roll_monster_drops and
    // node/logic/encouragement.js of kaansoral/adventureland_mongodb). Every roll is chance x luckm x monster level;
    // the encouragement bonus (Welcome Back, Lone Wolf: character.encouragement.totals.luck) is one extra roll per
    // contributor with contribution share x (bonus - 1) and that contributor's full luckm. Solo exactly
    // luckm x bonus (Lone Wolf x Welcome Back = 9 now); the party below (the party bonus is Welcome Back only).
    // The guide's drop rates are the plain table values (checked:
    // frog tongue 0.0025 = table), so this factor applies to every route - the guide's and our own. Monster level 1.
    // Party (v1.227.5, player decision 2026-11-23): the exact sum instead of leader luck x bonus -
    //   normal roll: the luck of the monster's target at death (kill log by target, last 10 min: the luck catcher's
    //                share and the tank's), plus
    //   bonus rolls: (bonus - 1) x each member's contribution share x its own luck (damage meter, last 5 min).
    // Members report their luckm with the goldm message (fighter.js); a member without a fresh report counts 1.
    // Heal points count as contribution on the server too, the meter sees damage only - the priest's bonus share
    // comes out a little small (the estimate errs low).
    function luckOfMember(name) {
        if (name === character.name) return Math.max(1, character.luckm || 1);
        const luck = deps.bus.get("memberLuck"); // fighter: the members' reported luck
        const r = luck && luck[name];
        return r && Date.now() - r.at < 5 * 60 * 1000 ? Math.max(1, r.l) : 1;
    }
    function partyLuck(bonus) {
        const team = deps.party.memberNames().filter(function (n) { return n !== config.merchant; });
        const now = Date.now();
        const mean = team.reduce(function (s, n) { return s + luckOfMember(n); }, 0) / Math.max(1, team.length);
        // Normal roll: kills of ours by target (no target: the team's mean luck).
        let kills = 0, normal = 0;
        (parent.__botKills || []).forEach(function (k) {
            if (now - k.t > 10 * 60 * 1000 || (k.target && !team.includes(k.target))) return;
            kills++;
            normal += k.target ? luckOfMember(k.target) : mean;
        });
        normal = kills >= 10 ? normal / kills : luckOfMember(character.name);
        // Bonus rolls: damage shares (equal shares while the meter has too little).
        const dmg = {};
        let total = 0;
        (parent.__botDps || []).forEach(function (h) {
            if (now - h.t > 5 * 60 * 1000 || !team.includes(h.who)) return;
            dmg[h.who] = (dmg[h.who] || 0) + h.dmg;
            total += h.dmg;
        });
        const extra = total > 0
            ? team.reduce(function (s, n) { return s + (dmg[n] || 0) / total * luckOfMember(n); }, 0)
            : mean;
        return normal + (bonus - 1) * extra;
    }
    function luckFactor() {
        const t = character.encouragement && character.encouragement.totals;
        const bonus = t && t.luck > 1 ? t.luck : 1;
        if (deps.party && deps.party.enabled && deps.party.memberNames && deps.party.memberNames().length > 1) return partyLuck(bonus);
        return Math.max(1, character.luckm || 1) * bonus;
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
        const luck = luckFactor(); // the guide counts no luck at all (v1.227.0)
        const consider = function (a) {
            if (!a || a.kind !== "farm" || !a.route || a.blocked || !G.monsters[a.route.monster]) return;
            // The guide's plain XP row (no item, no rate) says nothing about this drop.
            if (!(a.rate > 0) && !(a.meanSeconds > 0)) return;
            // Seconds per copy: the team's kill cycle divided by the drop rate (guide's own
            // numbers; one roll per kill, however many of us hit it).
            const cycle = teamCycle(a.route);
            const perCopy = (a.rate > 0 && cycle
                ? cycle / a.rate
                : a.meanSeconds * (cycle && a.route.cycle > 0 ? cycle / a.route.cycle : 1) / Math.max(1, need.copies)) / luck;
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
        const teamSafe = function (m) { return !deps.targeting || deps.targeting.isTeamSafe(m); };
        const out = [];
        routesNow.forEach(function (r) {
            if (!r) return;
            const rate = ((rates[r.monster] || 0) + (mapRates[r.map] || 0)) * luck;
            // The guide's own "safe" (for the leader alone) is not needed once the team model judges spots.
            const teamModel = deps.targeting && deps.targeting.teamModelOn && deps.targeting.teamModelOn();
            // isTeamSafe also knows our own solo check (targeting.soloRouteSafe, v1.226.8) - the guide's "safe" alone would
            // keep e.g. the Huge Crabs out solo.
            if (!(rate > 0) || !(r.cycle > 0) || (r.safe !== true && !teamModel && !teamSafe(r.monster)) || !teamSafe(r.monster)) return;
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

    // ---- drop cost (player decision 2026-11-20) ----------------------------------
    // What an hour of farming a drop costs us: the team's gold per hour on the spot we really
    // farm minus the gold per hour on the drop spot (never below 0) - the gold we give up, not
    // our whole income (the old rule took gold/hour from a 24 h window that held a 45M token
    // sale and priced buy orders far above the market). The merchant prices buy orders and
    // Ponty limits with it.
    function partySize() {
        const team = (config.team && config.team.fighters) || [];
        const n = team.filter(function (f) { return f === character.name || (deps.party && deps.party.inParty && deps.party.inParty(f)); }).length;
        return Math.max(1, n);
    }

    // ---- own gold per spot (player decision 2026-11-20) -------------------------
    // Every fighter counts the loot gold it gets (fighters sell nothing; handovers only lower
    // the gold) and the time spent per farm target - normal, drop and hunt spots, not events.
    // A moving window of sgCfg.windowH hours, kept across restarts. Members send their
    // rates to the leader, which adds them up: the team's real gold per hour on a spot, however
    // the game splits the party's gold.
    // The game splits every kill's gold over the party by share, and one account's fighters
    // share equally - wherever they stand. So a fighter's gold is a third of the team's only
    // while all of them farm the same spot; apart, each one's number mixes in the others' kills
    // (2026-11-20: the warrior's 140/s at iceroamer). Only those together-phases are counted
    // (player decision 2026-11-20, v1.151.0): all team fighters in the party, on our map and
    // instance, within sgCfg.togetherRange of us (live positions where we see them).
    const sgCfg = cfg.spotGold || {};
    function teamTogether() {
        const team = (config.team && config.team.fighters) || [];
        if (team.length < 2) return true;
        let p = null;
        try { p = get_party() || {}; } catch (e) { return false; }
        const range = sgCfg.togetherRange || 500;
        return team.every(function (n) {
            if (n === character.name) return true;
            if (!p[n]) return false; // not in the party: its gold is not shared with us
            // Live positions of the fighters we see; the party list's lag up to several
            // hundred px (2026-11-20: the priest's own entry was 360 px off).
            let e = null;
            try { e = parent.entities[n] || null; } catch (err) { e = null; }
            if (!e) {
                e = p[n];
                if (e.map !== character.map || (e.in && e.in !== character.in)) return false;
            }
            return Math.hypot((e.x || 0) - character.x, (e.y || 0) - character.y) <= range;
        });
    }
    const SPOT_KEY = "bot_spot_gold_v2:" + character.name; // v2: the mixed numbers before v1.151.0 are dropped
    const spotGold = (function () { try { return get(SPOT_KEY) || {}; } catch (e) { return {}; } })(); // monster -> { gold, sec }
    let lastGold = character.gold, lastTick = Date.now(), lastSpotSave = 0, lastSpotSend = 0;
    const memberRates = {}; // fighter -> { at, rates: { monster: gold/s } }
    function ownRates() {
        const out = {};
        Object.keys(spotGold).forEach(function (m) {
            const e = spotGold[m];
            if (e && e.sec >= (sgCfg.minMinutes || 10) * 60) out[m] = e.gold / e.sec;
        });
        return out;
    }
    function measure() {
        const now = Date.now();
        const dt = (now - lastTick) / 1000;
        const delta = character.gold - lastGold;
        lastTick = now;
        lastGold = character.gold;
        if (!(dt > 0) || dt > 10) return; // paused or lagging: no guess
        const f = deps.targeting && deps.targeting.farmNow ? deps.targeting.farmNow() : null;
        // Hunts count (v1.151.0): a monster's gold is the same whatever sent us there, and the
        // members got the leader's hunt target without its source and counted it anyway.
        if (character.rip || !f || !f.monster || f.any || /^event/.test(f.source || "")) return;
        if (!teamTogether()) return;
        const e = spotGold[f.monster] = spotGold[f.monster] || { gold: 0, sec: 0 };
        e.sec += dt;
        if (delta > 0) e.gold += delta;
        const win = (sgCfg.windowH || 3) * 3600;
        if (e.sec > win) { e.gold *= win / e.sec; e.sec = win; }
        if (now - lastSpotSave > 60 * 1000) {
            lastSpotSave = now;
            try { set(SPOT_KEY, spotGold); } catch (err) { /* storage unavailable */ }
        }
        if (!leads && config.leader && now - lastSpotSend > 60 * 1000) {
            lastSpotSend = now;
            comms.send(config.leader, "spotgold", { rates: ownRates() });
        }
    }
    if (sgCfg.enabled !== false) setInterval(function () { try { measure(); } catch (e) { /* measuring only */ } }, 1000);
    comms.on("spotgold", function (data, from) {
        if (!leads || !data || !data.rates || !((config.team && config.team.fighters) || []).includes(from)) return;
        memberRates[from] = { at: Date.now(), rates: data.rates };
    });
    // Team gold per second on a monster from our own numbers, or null when nobody measured it.
    // Fighters in the party without a number for it count as the average of those with one.
    function measuredTeam(monster) {
        const list = [];
        const own = ownRates()[monster];
        if (typeof own === "number") list.push(own);
        Object.keys(memberRates).forEach(function (n) {
            const r = memberRates[n];
            if (Date.now() - r.at > 5 * 60 * 1000 || !(deps.party && deps.party.inParty && deps.party.inParty(n))) return;
            if (typeof r.rates[monster] === "number") list.push(r.rates[monster]);
        });
        if (!list.length) return null;
        const sum = list.reduce(function (s, x) { return s + x; }, 0);
        return sum / list.length * Math.max(partySize(), list.length);
    }
    // Only our own numbers count (player decision 2026-11-20, v1.150.0): the guide's estimates
    // were off by 10x on one spot and 500x on another, so no factor fixes them. A drop spot
    // nobody measured counts as 0 gold - the full normal-spot gold is given up (upper bound,
    // the pot caps keep it safe). Without a measured normal spot there is no basis at all.
    let normalSpot = null; // { monster, map } - the last farm target that was no drop, event or hunt
    function noteNormalSpot() {
        const f = deps.targeting && deps.targeting.farmNow ? deps.targeting.farmNow() : null;
        if (!f || !f.monster || f.any || /^(drop|event|hunt)/.test(f.source || "")) return;
        normalSpot = { monster: f.monster, map: f.map || null };
    }
    // { goldH, monster, at(monster) } for this pass, or null while the normal spot (the last
    // farm target that was no drop, event or hunt) has no measured team gold yet.
    function goldBasis() {
        noteNormalSpot();
        if (!normalSpot) return null;
        const g = measuredTeam(normalSpot.monster);
        if (g === null) return null;
        return { goldH: Math.round(g * 3600), monster: normalSpot.monster, at: measuredTeam };
    }
    // Team gold per hour lost while farming route r instead of the normal spot.
    function costPerHour(basis, r) {
        if (!basis || !r) return null;
        const g = basis.at(r.monster);
        return Math.max(0, basis.goldH - Math.round((g === null ? 0 : g) * 3600));
    }
    let lastBasisLog = 0, basisWasNull = false;
    function logBasis(basis) {
        if (!basis) {
            if (!basisWasNull && normalSpot) util.log("drops", "drop cost basis: " + normalSpot.monster + " not measured yet - no drop costs, no wish orders", "white");
            basisWasNull = true;
            return;
        }
        if (!basisWasNull && Date.now() - lastBasisLog < 30 * 60 * 1000) return;
        basisWasNull = false;
        lastBasisLog = Date.now();
        util.log("drops", "drop cost basis: " + basis.monster + " ~" + Math.round(basis.goldH / 1000) + "k gold/h for the team (measured; unmeasured drop spots count as 0 gold)", "white");
    }
    function basisInfo(basis) { return basis ? { monster: basis.monster, goldH: basis.goldH } : null; }

    // Value report (stage 1): the merchant asks for per-copy farm times of the items its wishes
    // need, whether or not we farm for drops. One guide query per item, cached for 30 min.
    const timeCache = {}; // name -> { at, perCopy, costH }
    comms.on("timesfor", function (data, from) {
        if (from !== config.merchant || !leads) return;
        const times = {}, costs = {};
        const basis = goldBasis();
        (data.list || []).slice(0, 15).forEach(function (name) {
            if (!G.items[name]) return;
            const c = timeCache[name];
            if (c && Date.now() - c.at < 30 * 60 * 1000 && (c.costH !== null || !basis)) {
                if (c.perCopy) times[name] = c.perCopy;
                if (c.perCopy && c.costH !== null) costs[name] = c.costH;
                return;
            }
            const cands = routeFor({ name: name, copies: 1 }) || [];
            const best = cands[0] && isFinite(cands[0].perCopy) ? Math.round(cands[0].perCopy) : null;
            const costH = best ? costPerHour(basis, cands[0]) : null;
            timeCache[name] = { at: Date.now(), perCopy: best, costH: costH };
            if (best) times[name] = best;
            if (best && costH !== null) costs[name] = costH;
        });
        logBasis(basis);
        comms.send(config.merchant, "droptimes", { times: times, costs: costs, basis: basisInfo(basis) });
    });

    function check() {
        nextCheckAt = Date.now() + cfg.refreshMs;
        // Merchant reports older than an hour are stale (merchant gone); it reports every
        // few minutes, but long trips or upgrade runs can delay a report.
        if (Date.now() - needsAt > 60 * 60 * 1000) needs = [];
        const limit = cfg.maxHoursPerCopy * 3600;
        const found = [];
        const times = {}; // item -> seconds per copy on its best safe route (value report)
        const costs = {}; // item -> team gold per hour given up on that route (buy-order prices)
        const basis = goldBasis();
        const list = needs.slice();
        if (cfg.byValue && values && values.items) Object.keys(values.items).forEach(function (n) {
            if (!G.items[n] || list.some(function (x) { return x.name === n; })) return;
            const copies = values.items[n].reduce(function (m, w) { return Math.max(m, w.copies || 0); }, 0);
            if (copies > 0) list.push({ name: n, copies: Math.ceil(copies) });
        });
        list.forEach(function (need) {
            const cands = routeFor(need) || []; // null when the guide failed (2026-11-22 review: TypeError)
            const r = cands[0];
            if (r && isFinite(r.perCopy)) {
                times[need.name] = Math.round(r.perCopy);
                const ch = costPerHour(basis, r);
                if (ch !== null) costs[need.name] = ch;
            }
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
        logBasis(basis);
        if (config.merchant && Object.keys(times).length) comms.send(config.merchant, "droptimes", { times: times, costs: costs, basis: basisInfo(basis) });
    }

    function hours(seconds) {
        return seconds < 3600 ? Math.round(seconds / 60) + " min" : (seconds / 3600).toFixed(1) + " h";
    }

    // Stage 3: power per hour of each drop spot (the team's XP value scaled by the spot's XP rate,
    // plus the best wish per needed item that drops there) against the best XP spot.
    let lastValueLog = 0, lastValueKey = "";
    function valuePick(isCrowded) {
        const items = values.items || {};
        let ref = 0;
        try {
            ((get_progression() || {}).routes || []).forEach(function (r) {
                if (!r || !(r.cycle > 0) || !G.monsters[r.monster] || isBoss(r.monster)) return;
                if (deps.targeting && !deps.targeting.isTeamSafe(r.monster)) return;
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

    // Leader: the drop route to farm now, or null. isCrowded(monster) skips busy spots.
    function target(isCrowded) {
        if (!cfg.enabled || !leads) return null;
        if (Date.now() >= nextCheckAt) check();
        // By value without values (right after a restart): the XP spot, not the old "any drop
        // faster than maxHoursPerCopy" rule (2026-11-19: it sent the team to the arctic bees for
        // STR rings at 3.3 h per copy).
        if (cfg.byValue && !(values && Date.now() - valuesAt < 60 * 60 * 1000)) { lastPick = ""; return null; }
        if (cfg.byValue && values && Date.now() - valuesAt < 60 * 60 * 1000) {
            // The team's XP value unknown (a fighter restarted < 10 min ago): the XP spot, as
            // without values - counted as 0 it let every drop spot win (2026-11-20).
            if (typeof values.xpTeam !== "number" || !(values.xpTeam > 0)) {
                if (lastPick) util.log("drops", "XP value unknown (restart) - back to the XP spot", "white");
                lastPick = "";
                return null;
            }
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

    return {
        target: target,
        // Every item the merchant misses right now: [{ name, copies }] (wishes, craft ingredients, drops.want).
        needs: function () { return allNeeds.slice(); },
    };
};
