// =====================================================================
// roles/workshop/scrolls.js - the value report and the scroll choice.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const comms = deps.comms;
    const cfg = config.workshop;

    function scrollPrice(prefix, grade) {
        const s = G.items[prefix + grade];
        return s ? s.g || 0 : 0;
    }
    function gradeAt(name, level) {
        try { return item_grade({ name: name, level: level }); } catch (e) { return 0; }
    }

    // ---- scroll choice (player decision 2026-11-20, Earthiverse idea #3) -------------------
    // Per step the scroll with the lowest expected gold to the next level:
    //   (scroll price + (1 - chance) x what the lost copies are worth) / chance.
    // Chances from the server's own formulas (node/server.js, upgrade/compound, no offerings):
    //   upgrade:  base = G.upgrades[igrade][new]; a higher-grade scroll gives base x 1.2 + 0.01,
    //             capped at min(base + 0.36, base x 3) (normal: min(base + 0.24, base x 2)).
    //   compound: base = G.compounds[igrade][new]; higher: base x 1.1 + 0.001, capped at
    //             min(base x (3 + 0.6h), base + 0.2 + 0.05h), h = grades above (normal: min(base x 3, base + 0.2)).
    //   igrade = the item's grade at +0 (def.igrade); compounds from +3 on use the grade at level - 2.
    // The grace term adds the same to every scroll: taken from the real preview of the normal one.
    // Replaces the fixed High-scroll levels (risk.higherScrollFrom / gearHighScrollFrom): for shop gear
    // the normal scroll is cheaper up to +7 (helmet to +8: 1.7M instead of 3.8M with High from +5).
    function tableGrade(name, level, compound) {
        return compound && level >= 3 ? gradeAt(name, level - 2) : gradeAt(name, 0);
    }
    function baseChance(name, level, compound) {
        const t = (compound ? G.compounds : G.upgrades)[tableGrade(name, level, compound)] || {};
        return t[level + 1] || 0;
    }
    // name +level -> +level+1 with a scroll of grade sg; extra: the grace term (0 when unknown).
    function chanceWith(name, level, compound, sg, extra) {
        const b = baseChance(name, level, compound);
        const h = sg - gradeAt(name, level);
        if (h < 0 || !b) return 0;
        if (compound) {
            const p = (h > 0 ? b * 1.1 + 0.001 : b) + (extra || 0);
            return Math.min(1, p, b * (3 + (h > 0 ? h * 0.6 : 0)), b + 0.2 + (h > 0 ? h * 0.05 : 0));
        }
        // The server gives the higher-scroll bonus only up to the step to +10 (new_level <= 10).
        const high = h > 0 && level + 1 <= 10;
        const p = (high ? b * 1.2 + 0.01 : b) + (extra || 0);
        return high ? Math.min(1, p, b + 0.36, b * 3) : Math.min(1, p, b + 0.24, b * 2);
    }
    // What a copy of name +level is worth to us when a step fails: a sellTo price for that level
    // (we would sell it for that), else built up from its base with the cheapest scrolls. Base (+0):
    // sellTo price, NPC price, drop hours x team gold/h (dropCosts), else scrollChoice.unknownValue.
    function copyValue(name, level, memo) {
        memo = memo || {};
        if (memo[level] !== undefined) return memo[level];
        const def = G.items[name];
        const rule = ((((config.market || {}).sellTo || {}).items) || []).find(function (r) { return r.item === name && (r.level || 0) === level; });
        let v;
        if (rule) v = rule.minPrice;
        else if (level <= 0) {
            // Not in a shop: the larger of its drop hours at the team's gold/h and its game value x
            // valueFactor (Ponty sells such copies at about that: Wanderer's Gloves 6.8k -> ~24k).
            const t = wks.dropTimes[name], h = wks.dropCosts[name], sc = cfg.scrollChoice || {};
            const drop = t && typeof h === "number" && wks.farmable(name) ? t / 3600 * h : null;
            const resale = def.g ? def.g * (sc.valueFactor || 3) : null;
            v = wks.sellerOf(name) ? (def.g || 0) : (drop !== null || resale !== null) ? Math.max(drop || 0, resale || 0) : sc.unknownValue || 1000000;
        } else {
            const below = copyValue(name, level - 1, memo);
            const s = bestScroll(name, level - 1, !!def.compound, 0, below);
            v = def.compound ? s.cost : below + s.cost; // compound: s.cost already holds the three copies
        }
        memo[level] = v;
        return v;
    }
    // Cheapest scroll for name +level -> +level+1. normalChance: the real preview of the normal
    // scroll (null: formula only); lostValue: what one failure costs in copies (default copyValue).
    // Returns { scroll, grade, p, cost } - cost = expected gold for one copy of the next level
    // (compounds: including the three copies used up).
    function bestScroll(name, level, compound, normalChance, lostValue) {
        const prefix = compound ? "cscroll" : "scroll";
        const g = gradeAt(name, level);
        const value = lostValue !== undefined ? lostValue : copyValue(name, level);
        const pNormal = chanceWith(name, level, compound, g, 0);
        // The preview's surplus over the plain formula is the grace term (same for every scroll).
        const extra = typeof normalChance === "number" && normalChance > 0 ? Math.max(0, normalChance - pNormal) : 0;
        const maxG = (cfg.risk && cfg.risk.maxScrollGrade) || 2;
        let best = null;
        for (let sg = g; sg <= maxG; sg++) {
            if (!G.items[prefix + sg]) continue;
            const p = sg === g && typeof normalChance === "number" && normalChance > 0 ? normalChance : chanceWith(name, level, compound, sg, extra);
            if (!(p > 0)) continue;
            const price = scrollPrice(prefix, sg);
            const cost = compound ? (price + 3 * value) / p : (price + (1 - p) * value) / p;
            if (!best || cost < best.cost) best = { scroll: prefix + sg, grade: sg, p: p, cost: cost };
            if (cfg.scrollChoice && cfg.scrollChoice.enabled === false) break; // off: always the normal scroll
        }
        return best || { scroll: prefix + g, grade: g, p: pNormal, cost: Infinity };
    }
    // A higher scroll than the normal one pays off for this step: { scroll, p, cost, normalCost } or null.
    function cheaperScroll(name, level, compound, normalChance) {
        const g = gradeAt(name, level);
        const value = copyValue(name, level);
        const best = bestScroll(name, level, compound, normalChance, value);
        if (best.grade <= g) return null;
        const pn = normalChance;
        const price = scrollPrice(compound ? "cscroll" : "scroll", g);
        const normalCost = compound ? (price + 3 * value) / pn : (price + (1 - pn) * value) / pn;
        return { scroll: best.scroll, p: best.p, cost: best.cost, normalCost: normalCost };
    }
    // Expected cost of one copy at name +level from the copies we hold (bag and bank).
    function compoundCost(name, level) {
        const stock = wks.unlockedCopies(name);
        const count = function (l) { return stock.filter(function (x) { return x === l; }).length; };
        if (stock.some(function (x) { return x >= level; })) return { gold: 0, copies: 0 };
        let need = 1, gold = 0;
        const memo = {};
        for (let l = level; l >= 1; l--) {
            const deficit = Math.max(0, need - count(l));
            if (!deficit) return { gold: gold, copies: 0 };
            // The scroll the workshop would choose, chance from the server's formula (2026-11-20).
            const s = bestScroll(name, l - 1, true, null, copyValue(name, l - 1, memo));
            const p = s.p || 0.05;
            const attempts = deficit / p;
            gold += attempts * (G.items[s.scroll] ? G.items[s.scroll].g || 0 : 0);
            need = 3 * attempts;
        }
        return { gold: gold, copies: Math.max(0, need - count(0)) };
    }
    // fromScratch: as if we held no copy (expected base copies for the whole way).
    function upgradeCost(name, level, fromScratch) {
        const all = fromScratch ? [] : wks.unlockedCopies(name);
        if (all.some(function (x) { return x >= level; })) return { gold: 0, copies: 0, crafts: 0 };
        const stock = all.filter(function (x) { return x < level; });
        const start = stock.length ? Math.max.apply(null, stock) : 0;
        // Each step with the scroll the workshop would choose, chances from the server's formula
        // (2026-11-20: was always the normal scroll and the table of the current grade - +8 at 14 %
        // instead of 15 %; the server takes the item's grade at +0).
        const memo = {}, plan = {};
        const step = function (l) { return plan[l] || (plan[l] = bestScroll(name, l - 1, false, null, copyValue(name, l - 1, memo))); };
        const q = function (l) { return step(l).p || 0.05; };
        const chain = function (a) {
            let gold = 0, reach = 1;
            for (let l = a + 1; l <= level; l++) { gold += reach * (G.items[step(l).scroll] ? G.items[step(l).scroll].g || 0 : 0); reach *= q(l); }
            return { gold: gold, p: reach };
        };
        const first = chain(start), fresh = chain(0);
        const restarts = (1 - first.p) / Math.max(fresh.p, 1e-6);
        const bases = restarts + (stock.length ? 0 : 1);
        const shop = !!wks.sellerOf(name), craft = !shop && !!G.craft[name];
        const baseGold = shop ? (G.items[name].g || 0) : craft ? (G.craft[name].cost || 0) : 0;
        return { gold: first.gold + restarts * fresh.gold + (shop || craft ? bases * baseGold : 0), copies: shop || craft ? 0 : bases, crafts: craft ? bases : 0 };
    }
    // Gain, cost and gain per hour of one wish (null without a gain from the fighter).
    function wishValue(f, w, goldPerHour) {
        if (typeof w.gain !== "number") return null;
        const def = G.items[w.name];
        const c = def.compound ? compoundCost(w.name, w.level) : upgradeCost(w.name, w.level);
        let farmH = 0;
        const unknown = [];
        const needs = []; // { name, copies } to farm for this wish (stage 3: where the team goes)
        if (c.copies > 0.01) {
            needs.push({ name: w.name, copies: c.copies });
            if (wks.dropTimes[w.name]) farmH += c.copies * wks.dropTimes[w.name] / 3600; else unknown.push(w.name);
        }
        const recipe = c.crafts > 0 && G.craft[w.name] ? G.craft[w.name].items : [];
        // Crafted bases (Wanderer's pieces, Winged Boots): every expected craft needs the recipe.
        recipe.forEach(function (it) {
            const q = it[0], n = it[1];
            if (wks.sellerOf(n)) return; // bought (e.g. Shoes): already gold
            const miss = Math.max(0, c.crafts * q - wks.ingredientCount(n, 0));
            if (!miss) return;
            needs.push({ name: n, copies: miss });
            if (wks.dropTimes[n]) farmH += miss * wks.dropTimes[n] / 3600; else if (!unknown.includes(n)) unknown.push(n);
        });
        // Other craft ingredients reported missing for this wish (not counted above).
        Object.keys(wks.shortages).forEach(function (n) {
            const s = wks.shortages[n];
            if (s.forItem !== w.name || !s.need || recipe.some(function (it) { return it[1] === n; })) return;
            const miss = Math.max(0, s.need - wks.ingredientCount(n, s.level));
            if (!miss) return;
            needs.push({ name: n, copies: miss });
            if (wks.dropTimes[n]) farmH += miss * wks.dropTimes[n] / 3600; else if (!unknown.includes(n)) unknown.push(n);
        });
        const goldH = goldPerHour ? c.gold / goldPerHour : 0;
        const hours = goldH + farmH;
        return { fighter: f, item: w.name + " +" + w.level, gain: w.gain, gold: Math.round(c.gold), copies: Math.round(c.copies * 10) / 10,
            farmH: Math.round(farmH * 100) / 100, hours: Math.round(hours * 100) / 100, unknown: unknown, needs: needs, goldH: goldH,
            value: unknown.length ? null : hours > 0 ? Math.round(w.gain / hours * 100) / 100 : null };
    }
    // What an hour of farming earns in gold: the fighters' handovers only (player decision
    // 2026-11-21). The pots' income also counts trade sales (184 monster tokens and 3 vit earrings
    // sold for 229M in 20 h), which made gold look 11x cheaper here (12M/h instead of ~1M/h).
    function farmGoldPerHour(gb) {
        return gb.hours >= 1 && gb.fighters > 0 ? gb.fighters / gb.hours : null;
    }
    function cachedValue(f, w) {
        const now = Date.now();
        if (now - wks.valueGoldAt > 60 * 1000) {
            wks.valueGoldAt = now;
            wks.valueGold = farmGoldPerHour(wks.goalBudget());
        }
        const id = f + "|" + w.name + "|" + w.level + "|" + w.gain;
        const hit = wks.valueCache[id];
        if (hit && now - hit.at < 60 * 1000) return hit.v;
        const v = wishValue(f, w, wks.valueGold);
        wks.valueCache[id] = { at: now, v: v };
        return v;
    }

    function valueReport() {
        const vr = cfg.valueReport;
        if (!vr || !vr.enabled || Date.now() < wks.nextValueAt || !wks.bankSnapshot) return;
        wks.nextValueAt = Date.now() + (vr.everyMs || 15 * 60 * 1000);
        const goldPerHour = farmGoldPerHour(wks.goalBudget());
        const rows = [];
        wks.fighters().forEach(function (f) {
            wks.wishList(f).forEach(function (w) {
                const v = wishValue(f, w, goldPerHour);
                if (v) rows.push(v);
            });
        });
        rows.sort(function (a, b) { return (b.value === null ? -1 : b.value) - (a.value === null ? -1 : a.value); });
        // Stage 3: the leader weighs farm spots by these - XP value of the team and, per item to
        // farm, what each wish needing it gains and costs.
        const items = {};
        rows.forEach(function (r) {
            if (!(r.gain > 0)) return;
            (r.needs || []).forEach(function (n) {
                (items[n.name] = items[n.name] || []).push({ gain: r.gain, goldH: Math.round(r.goldH * 100) / 100, copies: Math.round(n.copies * 10) / 10, wish: r.item + " " + r.fighter });
            });
        });
        // A fighter without an XP rate yet (its first 10 min after a restart) makes the team's XP
        // value unknown (null), not smaller: counted as 0 it let every drop spot beat the XP spot
        // after each reload (2026-11-20).
        const team = (config.team && config.team.fighters) || [];
        const xpKnown = team.length > 0 && team.every(function (f) { return wks.fighterValues[f] && typeof wks.fighterValues[f].xpPower === "number"; });
        const xpTeam = xpKnown ? team.reduce(function (s, f) { return s + wks.fighterValues[f].xpPower; }, 0) : null;
        if (config.leader) comms.send(config.leader, "values", { xpTeam: xpTeam === null ? null : Math.round(xpTeam * 100) / 100, items: items });
        // Ask the leader for the farm times we still lack (answered with "droptimes").
        const ask = [];
        rows.forEach(function (r) { r.unknown.forEach(function (n) { if (!ask.includes(n)) ask.push(n); }); });
        // ... and the drop costs ownCost lacks (buy orders, Ponty limits).
        Object.keys(wks.costAsk).forEach(function (n) { if (!ask.includes(n) && G.items[n]) ask.push(n); });
        if (ask.length && config.leader) comms.send(config.leader, "timesfor", { list: ask });
        const goldOnly = rows.filter(function (r) { return r.farmH === 0 && !r.unknown.length && r.gold > 0 && r.gain > 0; });
        const perGold = goldOnly.reduce(function (m, r) { return Math.max(m, r.gain / r.gold); }, 0);
        wks.bestPerGold = perGold || wks.bestPerGold;
        const goldPower = goldPerHour && perGold ? Math.round(perGold * goldPerHour * 100) / 100 : null;
        const xp = Object.keys(wks.fighterValues).map(function (f) { const v = wks.fighterValues[f]; return f + " " + (v.xpPower === null || v.xpPower === undefined ? "?" : v.xpPower) + "%/h"; }).join(", ");
        const k = function (x) { return x >= 1e6 ? (x / 1e6).toFixed(1) + "M" : Math.round(x / 1000) + "k"; };
        util.log("value", "XP " + (xp || "?") + " | farm gold " + (goldPerHour ? k(goldPerHour) + "/h" : "?") + " = " + (goldPower === null ? "?" : goldPower + "%/h"), "white");
        rows.slice(0, vr.top || 6).forEach(function (r) {
            util.log("value", r.item + " " + r.fighter + ": " + (r.gain >= 0 ? "+" : "") + r.gain + "% for " + (r.unknown.length ? "? (no farm time: " + r.unknown.join(", ") + ")" : r.hours + " h") +
                " (" + k(r.gold) + (r.copies ? ", " + r.copies + " copies" : "") + ")" + (r.value === null ? "" : " -> " + r.value + "%/h"), "white");
        });
        try { set("bot_value_report", { at: Date.now(), goldPerHour: goldPerHour, goldPower: goldPower, xp: wks.fighterValues, rows: rows.slice(0, 25) }); } catch (e) { /* storage unavailable */ }
    }

    Object.assign(wks, {
        scrollPrice: scrollPrice,
        gradeAt: gradeAt,
        tableGrade: tableGrade,
        baseChance: baseChance,
        chanceWith: chanceWith,
        copyValue: copyValue,
        bestScroll: bestScroll,
        cheaperScroll: cheaperScroll,
        compoundCost: compoundCost,
        upgradeCost: upgradeCost,
        wishValue: wishValue,
        farmGoldPerHour: farmGoldPerHour,
        cachedValue: cachedValue,
        valueReport: valueReport,
    });
};
