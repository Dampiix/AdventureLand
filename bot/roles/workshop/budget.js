// =====================================================================
// roles/workshop/budget.js - the income-based budget for gear goals and the weapon ladder, risk tiers.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    function noteGold() {
        const d = character.gold - wks.lastGold;
        wks.lastGold = character.gold;
        if (!d) return;
        const now = Date.now();
        let b = wks.income.flow[wks.income.flow.length - 1];
        if (!b || now - b.t >= 10 * 60 * 1000) { b = { t: now, in: 0, out: 0 }; wks.income.flow.push(b); }
        if (d > 0) b.in += d; else b.out -= d;
        if (now - wks.flowSavedAt > 60 * 1000) { wks.flowSavedAt = now; saveIncome(); }
    }
    function saveIncome() {
        wks.income.lastGold = wks.lastGold;
        try { set(wks.INCOME_KEY, wks.income); } catch (e) { /* storage unavailable */ }
    }

    function sampleIncome() {
        const now = Date.now();
        const last = wks.income.samples[wks.income.samples.length - 1];
        if (last && now - last.t < 10 * 60 * 1000) return;
        wks.income.samples.push({ t: now, gold: character.gold }); // for workshop.keepGold's 24 h peak
        const since = now - wks.DAY;
        wks.income.samples = wks.income.samples.filter(function (s) { return s.t >= since; });
        wks.income.flow = wks.income.flow.filter(function (b) { return b.t >= since; });
        wks.income.spends = wks.income.spends.filter(function (s) { return s.t >= since; });
        wks.income.credits = (wks.income.credits || []).filter(function (c) { return c.t >= since; });
        saveIncome();
    }

    // budget.resetAt once it has passed: everything before it is ignored (0 = no mark).
    function resetMark() {
        const r = cfg.gearGoals.budget && cfg.gearGoals.budget.resetAt;
        const t = r ? Date.parse(r) : 0;
        return t && t <= Date.now() ? t : 0;
    }
    function goalBudget() {
        const b = cfg.gearGoals.budget;
        // A reset mark: everything booked before it is gone.
        const mark = resetMark();
        if (mark && wks.income.flow.some(function (x) { return x.t < mark; })) {
            ["flow", "spends", "credits", "samples"].forEach(function (n) { wks.income[n] = (wks.income[n] || []).filter(function (x) { return x.t >= mark; }); });
            saveIncome();
            util.log("workshop", "budget reset: every pot starts from 0 now", "yellow");
        }
        // Right after a reset nothing is booked yet: a player-granted extra counts already (2026-11-20:
        // the 20M extra waited for the first gold change).
        const extraNow = b.extra && b.extra.amount && Date.now() < Date.parse(b.extra.until) ? b.extra.amount : 0;
        if (!wks.income.flow.length) return { allowed: extraNow, earned: 0, spent: 0, hours: 0, gross: 0, fighters: 0, consumables: 0 };
        const since = Date.now() - wks.DAY;
        const flow = wks.income.flow.filter(function (x) { return x.t >= since; });
        const gross = flow.reduce(function (sum, x) { return sum + x.in; }, 0);
        const out = flow.reduce(function (sum, x) { return sum + x.out; }, 0);
        const fighters = (wks.income.credits || []).reduce(function (sum, c) { return c.t >= since ? sum + c.a : sum; }, 0);
        // Workshop spending is booked (pay); the rest of the spending is consumables.
        const spentAll = wks.income.spends.reduce(function (sum, s) { return s.t >= since ? sum + s.a : sum; }, 0);
        const spentInWindow = wks.income.spends.reduce(function (sum, s) { return s.k || s.t < since ? sum : sum + s.a; }, 0); // gear pot only
        const consumables = Math.max(0, out - spentAll);
        const earned = gross - consumables;
        // A player-granted extra (budget.extra: { amount, until }) on top of the income share,
        // e.g. to gear up a new character faster. What it pays for still counts as spent in
        // the 24 h window, so after it expires the income share has to catch up first.
        const extra = b.extra && b.extra.amount && Date.now() < Date.parse(b.extra.until) ? b.extra.amount : 0;
        let allowed = Math.max(0, earned * b.incomeShare + extra - spentInWindow);
        if (b.total) allowed = Math.min(allowed, Math.max(0, b.total - wks.income.total));
        return { allowed: allowed, earned: earned, spent: spentInWindow, hours: Math.min(24, (Date.now() - flow[0].t) / 3600000),
            gross: gross, fighters: fighters, consumables: consumables };
    }

    // Ladder budget (player decision 2026-11-17): its own share of the last 24 h of income
    // (bruteForce.incomeShare) - no fixed amount, it grows with the account. The weapon ladder itself is
    // gone (2026-11-22: its weapons are dismantled); the pot pays the material goals (MG.borrowFrom).
    function ladderBudget() {
        const share = (cfg.bruteForce && cfg.bruteForce.incomeShare) || 0;
        const spentLadder = wks.income.spends.reduce(function (sum, s) { return s.k === wks.LADDER ? sum + s.a : sum; }, 0);
        const earned = goalBudget().earned;
        // A player-granted extra (bruteForce.extra: { amount, until }), like the gear pot's.
        const ex = cfg.bruteForce && cfg.bruteForce.extra;
        const extra = ex && ex.amount && Date.now() < Date.parse(ex.until) ? ex.amount : 0;
        return { allowed: Math.max(0, earned * share + extra - spentLadder), earned: earned, spent: spentLadder };
    }

    // Grace budget per target level and 24 h (player decision 2026-11-16): a share of the
    // merchant's net income over the last 24 h (grace.incomeShare, like the gear goals),
    // never below grace.budgetPerLevel. Grace spending itself is not a loss of income.
    function graceBudget() {
        const g = cfg.grace;
        const mark = resetMark();
        if (mark && wks.graceSince < mark) { // budget.resetAt: grace spending starts over too
            Object.keys(wks.spent).forEach(function (k) { if (k.indexOf("grace:") === 0) delete wks.spent[k]; });
            wks.graceSince = mark;
            saveGraceSpent();
        }
        if (!g.incomeShare) return g.budgetPerLevel;
        let graceSpent = 0;
        Object.keys(wks.spent).forEach(function (k) { if (k.indexOf("grace:") === 0) graceSpent += wks.spent[k] || 0; });
        const earned = goalBudget().earned + graceSpent;
        // A player-granted extra per level (grace.extra: { amount, until }), like the gear goals.
        const extra = g.extra && g.extra.amount && Date.now() < Date.parse(g.extra.until) ? g.extra.amount : 0;
        return Math.max(g.budgetPerLevel || 0, Math.round(earned * g.incomeShare)) + extra;
    }
    function saveGraceSpent() {
        const graceSpent = {};
        Object.keys(wks.spent).forEach(function (k) { if (k.indexOf("grace:") === 0) graceSpent[k] = wks.spent[k]; });
        try { set(wks.GRACE_KEY, { since: wks.graceSince, spent: graceSpent }); } catch (e) { /* storage unavailable */ }
    }

    // An NPC shop selling this item – in town (main) only, like before.
    function sellerOf(name) {
        const id = Object.keys(G.npcs).find(function (n) {
            const p = Array.isArray(G.npcs[n].items) && G.npcs[n].items.includes(name) && wks.npcPos(n);
            return p && p.map === "main";
        });
        return id || null;
    }

    // ---- risk -------------------------------------------------------------------

    // Minimum success chance for risking `item` (`copies` of it, 3 for compounds), by how
    // it is replaced (player decision 2026-11-16): shop gear is simply bought again,
    // compound copies come from drops, token/drop items (Hunter set, Phoenix weapons)
    // take longest to replace.
    function minChanceFor(item, replaceable, copies) {
        const r = cfg.risk;
        // Items whose copies we can always make again (e.g. Rugged from armor boxes): like shop gear.
        if ((r.free || []).includes(item.name)) return r.shop;
        if ((copies || 1) >= 3 || (G.items[item.name] && G.items[item.name].compound)) return r.compound;
        return replaceable ? r.shop : r.rare;
    }

    function pct(x) { return Math.round(x * 100) + "%"; }

    // The normal scroll is not good enough: try higher scroll grades (owned, banked,
    // or bought within the wish budget) until the preview reaches minChance.
    // preview(scrollIndex) -> chance. Returns { scroll, chance } or null.
    async function strongerScroll(k, prefix, grade, minChance, preview) {
        for (let g = grade + 1; g <= cfg.risk.maxScrollGrade; g++) {
            const name = prefix + g;
            if (!G.items[name]) continue;
            if (wks.bagIndex(name, 0) === -1) {
                const banked = wks.bankSnapshot && wks.bankSnapshot.items.find(function (b) { return b.name === name; });
                const seller = sellerOf(name);
                if (banked) {
                    await wks.retrieve(banked);
                } else if (cfg.risk.buyStrongerScrolls && seller && wks.canSpend(k, G.items[name].g)) {
                    await wks.goTo(seller);
                    await buy(name, 1);
                    wks.pay(k, G.items[name].g);
                } else {
                    continue;
                }
            }
            await wks.goTo("newupgrade");
            const chance = await preview(wks.bagIndex(name, 0));
            if (chance >= minChance) return { scroll: name, chance: chance };
            util.log("workshop", "even with " + name + " only " + pct(chance), "white");
        }
        return null;
    }

    Object.assign(wks, {
        noteGold: noteGold,
        saveIncome: saveIncome,
        sampleIncome: sampleIncome,
        resetMark: resetMark,
        goalBudget: goalBudget,
        ladderBudget: ladderBudget,
        graceBudget: graceBudget,
        saveGraceSpent: saveGraceSpent,
        sellerOf: sellerOf,
        minChanceFor: minChanceFor,
        pct: pct,
        strongerScroll: strongerScroll,
    });
};
