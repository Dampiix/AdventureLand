// =====================================================================
// roles/workshop/bank.js - the bank snapshot and fetching copies; spending per wish: pauses after failures, the budget
// per wish, the gold we keep, paying from a pot (developing a wish: grace.js develop).
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    // ---- bank -------------------------------------------------------------

    // Only a read inside the loaded bank counts (util.bankLoaded); otherwise the old snapshot
    // stays and false comes back.
    function readBank() {
        if (!util.bankLoaded()) return false;
        const items = [];
        Object.keys(character.bank || {}).forEach(function (pack) {
            if (!/^items\d+$/.test(pack)) return;
            (character.bank[pack] || []).forEach(function (item, index) {
                if (item) items.push({ pack: pack, index: index, name: item.name, level: item.level || 0, q: item.q || 1, stat: item.stat_type || null });
            });
        });
        const packs = Object.keys(character.bank || {}).filter(function (p) { return /^items\d+$/.test(p); });
        // Every pack holds 42 (server); a newly bought one starts as an empty list and only
        // grows as things go in, so its list length undercounts the room.
        const capacity = packs.length * 42;
        wks.bankSnapshot = { at: Date.now(), items: items, free: capacity - items.length };
        try { set(wks.BANK_KEY, wks.bankSnapshot); } catch (e) { /* storage unavailable */ }
        return true;
    }

    function bankFind(name, filter) {
        if (!wks.bankSnapshot) return null;
        return wks.bankSnapshot.items.filter(function (b) { return b.name === name && filter(b.level); })
            .sort(function (a, b) { return b.level - a.level; })[0] || null;
    }

    async function retrieve(entry) {
        // Bag reserve (2026-11-22, player decision): copies come out of the bank only while bagReserve slots stay
        // free afterwards - the workshop filled the bag to 2 free slots right after the merchant had banked for a
        // pickup, so copies went back and forth and pickups failed with send_no_space.
        const reserve = cfg.bagReserve || 0;
        if (character.esize < 1 + reserve) throw { reason: reserve ? "bag full (keeping " + reserve + " slots free for pickups)" : "bag full" };
        if (!(await util.walkToBank())) throw { reason: "not inside the bank after the walk" };
        readBank();
        let fresh = wks.bankSnapshot.items.find(function (b) { return b.pack === entry.pack && b.index === entry.index && b.name === entry.name; });
        // An older snapshot (we took a copy since, or the player moved things): any slot with
        // the same item and level will do - the wish used to pause for an hour (2026-11-17).
        if (!fresh) {
            fresh = wks.bankSnapshot.items.find(function (b) {
                return b.name === entry.name && b.level === entry.level && (b.stat || null) === (entry.stat || null);
            });
        }
        if (!fresh) throw { reason: entry.name + " moved in the bank" };
        entry = fresh;
        await bank_retrieve(entry.pack, entry.index);
        util.log("workshop", "took " + entry.name + (entry.q > 1 ? " x" + entry.q : " +" + entry.level) + " from the bank", "green");
        readBank();
    }

    // ---- develop ----------------------------------------------------------

    // How long a stopped job waits before the next try. Too little gold right now
    // (fighters hand gold over regularly) is retried soon; a used-up wish budget
    // or any other reason (too risky, no copies, ...) waits giveUpForMs.
    function pauseAfter(k, reason) {
        // A full bag clears soon (banking, pickups, sales): again in a few minutes, not after an hour (2026-11-22).
        if (/space|bag full/.test(String(reason || ""))) return cfg.retryAfterBudgetMs || cfg.giveUpForMs;
        if (reason === "budget" && k !== wks.GOALS && !isOwn(k) && wks.goalBudget().allowed < 10000) return cfg.retryAfterBudgetMs || cfg.giveUpForMs;
        if (reason !== "budget" || k === wks.GOALS) return cfg.giveUpForMs;
        const left = budgetFor(k) - (wks.spent[k] || 0);
        return left < 10000 ? cfg.giveUpForMs : (cfg.retryAfterBudgetMs || cfg.giveUpForMs);
    }

    // Budget per key: wishes use budgetPerWish, grace keys ("grace:<level>") their own.
    // budgetPerWish may be split { shop, rare }: shop gear vs token/drop items, whose
    // higher scrolls are worth more than a lost copy (player decision 2026-11-16).
    function budgetFor(k) {
        if (k.indexOf("grace:") === 0) return wks.graceBudget();
        const b = cfg.budgetPerWish;
        if (typeof b !== "object") return b;
        const name = k.split(":")[1];
        if (b.byItem && b.byItem[name]) return b.byItem[name];
        return G.items[name] && !wks.sellerOf(name) ? b.rare : b.shop;
    }

    // workshop.keepGold: a number, or { share, max } (player decision 2026-11-19): share of the
    // highest merchant gold of the last 24 h, at most max - a fresh account starts at once and
    // the floor grows with the capital (a share of the current gold alone would shrink with
    // every purchase).
    function keepGold() {
        const kg = cfg.keepGold;
        if (typeof kg === "number") return kg;
        if (!kg) return 0;
        const peak = (wks.income.samples || []).reduce(function (m, s) { return Math.max(m, s.gold || 0); }, character.gold);
        return Math.min(kg.max || Infinity, peak * (kg.share || 0));
    }
    function canSpend(k, amount) {
        // Never below the floor: the larger of the potion reserve and workshop.keepGold. The
        // merchant's own wishes (stand, tools) only keep the potion reserve - a fresh account
        // must not wait for millions to buy a 40k stand.
        const reserve = util.goldAmount(config.merchantRole.goldReserve);
        const floor = k.indexOf("_own:") === 0 ? reserve : Math.max(reserve, keepGold());
        if (character.gold - amount < floor) return false;
        // Tidy-up (v1.224.2, player decision 2026-11-23): an auto-compound step costing at most compound.tidyMaxCost
        // never waits for a pot - three bank slots become one for a 6.4k scroll (jewellery up to +2).
        if (k.indexOf("auto:") === 0 && amount <= ((cfg.compound || {}).tidyMaxCost || 0)) return true;
        // Main stat before a hand-over (v1.226.2): the scrolls are cheap, no pot needed up to statOnDelivery.maxCost.
        if (k.indexOf("_stat:") === 0 && amount <= ((cfg.statOnDelivery || {}).maxCost || 0)) return true;
        if (k === wks.GOALS) return wks.goalBudget().allowed >= amount;
        if (k === wks.LADDER) return wks.ladderBudget().allowed >= amount;
        if ((wks.spent[k] || 0) + amount > budgetFor(k)) return false; // safety cap per wish
        // One pot for all gear (player decision 2026-11-19): wishes, weapon plans, stock rules,
        // stat scrolls - everything but the merchant's own tools - pays from the gear pot.
        return isOwn(k) || wks.goalBudget().allowed >= amount;
    }
    function isOwn(k) { return k.indexOf("_own:") === 0; }

    // Every workshop spend goes into the income window, so the income the pots share is the
    // gross income minus consumables only (potions, materials bought through buy orders):
    // gear spending is never a loss of income (player decision 2026-11-19, one gear pot).
    // Ladder spends carry their key; the merchant's own tools are put back into
    // the income but charged to no pot; everything else is gear-pot spending.
    function pay(k, amount) {
        if (k === wks.LADDER) {
            wks.income.spends.push({ t: Date.now(), a: amount, k: k });
            wks.saveIncome();
            return;
        }
        if (isOwn(k)) wks.income.spends.push({ t: Date.now(), a: amount, k: "own" });
        else {
            wks.income.spends.push({ t: Date.now(), a: amount });
            wks.income.total += amount;
        }
        wks.saveIncome();
        if (k === wks.GOALS) return;
        wks.spent[k] = (wks.spent[k] || 0) + amount;
        if (k.indexOf("grace:") === 0) wks.saveGraceSpent();
    }

    Object.assign(wks, {
        readBank: readBank,
        bankFind: bankFind,
        retrieve: retrieve,
        pauseAfter: pauseAfter,
        budgetFor: budgetFor,
        keepGold: keepGold,
        canSpend: canSpend,
        isOwn: isOwn,
        pay: pay,
    });
};
