// =====================================================================
// roles/workshop/crafting.js - crafting.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    // ---- crafting -----------------------------------------------------------------
    //
    // Items without a shop that have a recipe (G.craft) are crafted: at Cole for his
    // monster-material recipes, at the witch for hers, at Leo for the rest. The
    // ingredients come from bag and bank; each one must sit in a single stack, so
    // split stacks are merged through the bank first. Missing ingredients are
    // reported for drop farming.

    function crafterOf(name) {
        const r = G.craft && G.craft[name];
        if (!r) return null;
        const id = r.quest
            ? Object.keys(G.npcs).find(function (n) { return G.npcs[n].quest === r.quest && wks.npcPos(n); })
            : Object.keys(G.npcs).find(function (n) { return G.npcs[n].role === "craftsman" && wks.npcPos(n); });
        return id || null;
    }

    function stackable(name) {
        return !!(G.items[name] && G.items[name].s);
    }

    // How many we hold (bag + bank): stack quantities, or copies at exactly `level`.
    function ingredientCount(name, level) {
        let n = 0;
        character.items.forEach(function (i) {
            if (!i || i.name !== name || i.l) return;
            if (stackable(name)) n += i.q || 1;
            else if ((i.level || 0) === level) n++;
        });
        (wks.bankSnapshot ? wks.bankSnapshot.items : []).forEach(function (b) {
            if (b.name !== name) return;
            if (stackable(name)) n += b.q || 1;
            else if (b.level === level) n++;
        });
        return n;
    }

    // Get `q` of an ingredient into the bag (one stack for stackables).
    async function gatherIngredient(name, q, level) {
        if (stackable(name)) {
            if (util.findItemIndex(function (i) { return i.name === name && (i.q || 1) >= q; }) !== -1) return;
            if (!(await util.walkToBank())) throw { reason: "not inside the bank after the walk" };
            // Bag stacks go into the bank first: storing merges them into one stack.
            for (let i = character.items.length - 1; i >= 0; i--) {
                if (character.items[i] && character.items[i].name === name) await bank_store(i);
            }
            wks.readBank();
            const stack = wks.bankSnapshot.items.filter(function (b) { return b.name === name; })
                .sort(function (a, b) { return b.q - a.q; })[0];
            if (!stack || stack.q < q) throw { reason: name + " is split across stacks (" + (stack ? stack.q : 0) + "/" + q + " in one)" };
            await wks.retrieve(stack);
            return;
        }
        if (wks.bagIndex(name, level) !== -1 && character.items.some(function (i) { return i && i.name === name && (i.level || 0) === level; })) return;
        const banked = wks.bankFind(name, function (l) { return l === level; });
        if (!banked) throw { reason: "no " + name + " +" + level + " for crafting" };
        await wks.retrieve(banked);
    }

    // Shared materials (2026-11-22, gear plan v2): a recipe that is no weapon waits while the material's weapon goals
    // (materialGoals) are open - essence of fire goes to the fire weapons first; and workshop.materialOrder
    // lists who gets a material first (essence of ether: Thundergrips, Moonshard, Wind Belt) - a recipe waits while an
    // item before it is still wished by a fighter. Returns why it waits, or null.
    function materialHold(name, recipe) {
        for (const it of recipe.items || []) {
            const mat = it[1];
            if (G.items[name] && G.items[name].type !== "weapon") {
                const m = wks.allMaterials().find(function (x) { return x.mat === mat; });
                if (m && m.goalState().all.length) return mat + " goes to the weapon goals first";
            }
            const order = (cfg.materialOrder || {})[mat];
            const at = order ? order.indexOf(name) : -1;
            if (at > 0) {
                const first = order.slice(0, at).find(function (n) {
                    return wks.fighters().some(function (f) { return wks.wishList(f).some(function (w) { return w.name === n; }); });
                });
                if (first) return mat + " kept for " + first;
            }
        }
        return null;
    }
    // A missing ingredient at a level (hunter gloves +6, INT ring +2 ...) we can build ourselves: an upgradeable item with
    // a lower copy, a shop or a token offer; a compound item with enough lower copies (3 per level).
    function ingredientBuildable(name, level) {
        const def = G.items[name];
        if (!def || level <= 0) return false;
        if (def.upgrade) return wks.totalCopies(name, function (l) { return l < level; }) > 0 || !!wks.sellerOf(name) || !!wks.tokenOffer(name);
        if (def.compound) {
            let units = 0;
            for (let l = 0; l < level; l++) units += (wks.bagCopies(name, l).length + wks.bankCopies(name, l).length) * Math.pow(3, l);
            return units >= Math.pow(3, level);
        }
        return false;
    }

    // Returns { ok: true } after crafting, or { ok: false, missing: [{ name, level, need }] }, or
    // { ok: false, working: true } after a step on a missing ingredient (the next round goes on).
    async function craftItem(k, name) {
        const recipe = G.craft[name];
        const npc = crafterOf(name);
        if (!recipe || !npc) return { ok: false, missing: [] };
        const hold = materialHold(name, recipe);
        if (hold) throw { reason: hold };
        const missing = [];
        recipe.items.forEach(function (it) {
            const q = it[0], ing = it[1], level = it[2] || 0;
            const have = ingredientCount(ing, level);
            if (have < q) missing.push({ name: ing, level: level, need: q, have: have });
        });
        // Only shop items at +0 can be bought: the rest must be found or farmed.
        const buyable = missing.filter(function (m) { return m.level === 0 && wks.sellerOf(m.name); });
        const farmable = missing.filter(function (m) { return buyable.indexOf(m) === -1; });
        // Only leveled ingredients we can build are missing (2026-11-22): build one of them first - one step per round.
        if (farmable.length && farmable.every(function (m) { return ingredientBuildable(m.name, m.level); })) {
            const m = farmable[0];
            util.log("workshop", "building " + m.name + " +" + m.level + " for " + G.items[name].name, "white");
            await wks.develop("_ing", { name: m.name, level: m.level }, { budgetKey: k, replaceable: !!wks.sellerOf(m.name), spare: true, minChance: 0 });
            return { ok: false, working: true };
        }
        if (farmable.length) return { ok: false, missing: farmable };
        for (const m of buyable) {
            const amount = m.need - m.have;
            const cost = amount * G.items[m.name].g;
            if (!wks.canSpend(k, cost)) throw { reason: "budget" };
            if (character.esize < (stackable(m.name) ? 1 : amount) + 1) throw { reason: "bag full" };
            await wks.goTo(wks.sellerOf(m.name));
            if (stackable(m.name)) await buy(m.name, amount);
            else for (let i = 0; i < amount; i++) await buy(m.name, 1);
            wks.pay(k, cost);
            util.log("workshop", "bought " + amount + "x " + m.name + " for crafting " + name, "white");
        }
        if (recipe.cost && !wks.canSpend(k, recipe.cost)) throw { reason: "budget" };
        if (character.esize < recipe.items.length + 1) throw { reason: "bag full" };
        for (const it of recipe.items) await gatherIngredient(it[1], it[0], it[2] || 0);
        await wks.goTo(npc);
        let at = npc;
        try {
            await auto_craft(name);
        } catch (e) {
            // Recipes without a named specialist go to Leo, but some (e.g. the cave items)
            // are crafted by Cole: retry there when Leo turns it down.
            if (util.errReason(e) !== "distance" || npc === "mcollector" || !wks.npcPos("mcollector")) throw e;
            at = "mcollector";
            await wks.goTo(at);
            await auto_craft(name);
        }
        if (recipe.cost) wks.pay(k, recipe.cost);
        util.log("workshop", "crafted " + G.items[name].name + " at " + (G.npcs[at].name || at), "green");
        return { ok: true };
    }

    // Make sure a scroll is in the bag; buys enough for the remaining steps in one trip.
    async function ensureScroll(k, scroll, stepsLeft) {
        if (wks.bagIndex(scroll, 0) !== -1) return;
        const price = G.items[scroll].g;
        let amount = Math.max(1, stepsLeft);
        while (amount > 1 && !wks.canSpend(k, price * amount)) amount--;
        if (!wks.canSpend(k, price * amount)) throw { reason: "budget" };
        await wks.goTo("scrolls");
        await buy(scroll, amount);
        wks.pay(k, price * amount);
    }

    Object.assign(wks, {
        crafterOf: crafterOf,
        stackable: stackable,
        ingredientCount: ingredientCount,
        gatherIngredient: gatherIngredient,
        materialHold: materialHold,
        ingredientBuildable: ingredientBuildable,
        craftItem: craftItem,
        ensureScroll: ensureScroll,
    });
};
