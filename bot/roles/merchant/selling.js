// =====================================================================
// roles/merchant/selling.js - selling junk to NPCs and restocking the potions the fighters use.
// Part of bot_merchant (module plan, stage 6b): moved verbatim from the old single-file roles/merchant.js. The parts
// share one internal state (mer: pickup requests, trips, the stand, timers) and call each other through mer;
// outside dependencies come in deps (config, util, comms, workshop).
// =====================================================================

module.exports = function install(mer, deps) {
    const config = deps.config;
    const util = deps.util;
    const m = config.merchantRole;
    const workshop = deps.workshop;

    // sellList entries: "name" (only +0) or { name, maxLevel }.
    function sellRule(name) {
        for (const entry of m.sellList) {
            if (entry === name) return { maxLevel: 0 };
            if (entry && entry.name === name) return { maxLevel: entry.maxLevel || 0 };
        }
        return null;
    }

    // config.merchantRole.sellBuyable: don't store what a shop sells anyway.
    function isBuyableJunk(item) {
        const rule = m.sellBuyable;
        if (!rule || !rule.enabled || !mer.npcSold.has(item.name)) return false;
        const def = G.items[item.name];
        if (!def || rule.exceptTypes.includes(def.type) || m.bank.keep.includes(item.name)) return false;
        return (item.level || 0) <= rule.maxLevel;
    }

    function isSellable(item) {
        if (item.p || item.l) return false;            // shiny / locked never
        if (workshop.isReserved(item)) return false;    // a fighter wishes for it
        if (workshop.fillsEmptySlot(item)) return false; // a team fighter has that slot empty (e.g. a new rogue)
        if (workshop.isOrphanStatCopy(item)) return true;   // shop armor in a stat no fighter still builds
        if (workshop.isSpareJoyRing(item)) return true;     // every fighter wears two rings at +2 or better
        if (workshop.isDoneBoxArmor(item)) return true;     // Rugged piece already worn/held at +7 (before the goal-stock rule: a worn Rugged helmet makes its name a goal name)
        if (workshop.isGoalStock(item)) return false;   // a gear-goal copy (worn piece, level 1+)
        if (workshop.isOutgrownGoalCopy(item)) return true; // shop gear below a finished gear goal
        const rule = sellRule(item.name);
        if (rule && (item.level || 0) <= rule.maxLevel) return true;
        // Leftover grace fodder (any level) has done its job.
        if (config.workshop.grace && item.name === config.workshop.grace.fodder) return true;
        if (isOutgrownPotion(item)) return true;
        return isBuyableJunk(item);
    }

    async function sellJunk() {
        let sold = 0;
        for (;;) {
            const index = util.findItemIndex(isSellable);
            if (index === -1) break;
            const item = character.items[index];
            await sell(index, item.q || 1);
            sold++;
        }
        if (sold) util.log("merchant", "sold " + sold + " junk stacks", "green");
    }

    // Fighters ask for their current potion sizes with every pickup (at least every
    // 15 min). A size nobody asked for within an hour is outgrown: no restocking,
    // and our leftovers of it are sold.
    function isWantedPotion(name) {
        return mer.stocked.has(name) && Date.now() - mer.stocked.get(name) < 60 * 60 * 1000;
    }
    function isOutgrownPotion(item) {
        return /^(hpot|mpot)\d+$/.test(item.name) && Date.now() - mer.startedAt > 60 * 60 * 1000 && !isWantedPotion(item.name);
    }

    // Fighters that asked for this potion size within the last hour.
    function userCount(name) {
        const u = mer.users.get(name);
        if (!u) return 0;
        let n = 0;
        u.forEach(function (at) { if (Date.now() - at < 60 * 60 * 1000) n++; });
        return n;
    }

    // With `wanted` (a delivery): buy what this delivery needs. Without (chores):
    // build a stock of potions.target per fighter using the size (max stockPerPotion) –
    // but only while we have stockFromGold, so equipment wishes get the gold first.
    async function restock(wanted) {
        Object.keys(wanted || {}).forEach(function (name) { if (G.items[name] && G.items[name].type === "pot") mer.stocked.set(name, Date.now()); });
        if (!wanted && character.gold < (m.stockFromGold || 0)) return;
        for (const name of mer.stocked.keys()) {
            if (!isWantedPotion(name)) continue; // nobody drinks this size any more
            const target = wanted
                ? (wanted[name] || 0)
                : Math.min(m.stockPerPotion, Math.max(1, userCount(name)) * config.potions.target);
            const missing = target - util.countItem(name);
            if (missing <= 0) continue;
            const price = G.items[name].g;
            const affordable = Math.floor(Math.max(0, character.gold - util.goldAmount(m.goldReserve)) / price);
            const amount = Math.min(missing, affordable);
            if (amount <= 0) {
                if (Date.now() - (mer.poorLogged[name] || 0) > 10 * 60 * 1000) {
                    mer.poorLogged[name] = Date.now();
                    util.log("merchant", "not enough gold above the reserve for " + name + " - fighters buy their own", "orange");
                }
                continue;
            }
            if (character.esize < 1 && util.countItem(name) === 0) {
                util.log("merchant", "bag full - cannot buy " + name, "red");
                continue;
            }
            await buy(name, amount);
            util.log("merchant", "bought " + amount + " " + name, "green");
        }
    }

    Object.assign(mer, {
        sellRule: sellRule,
        isBuyableJunk: isBuyableJunk,
        isSellable: isSellable,
        sellJunk: sellJunk,
        isWantedPotion: isWantedPotion,
        isOutgrownPotion: isOutgrownPotion,
        userCount: userCount,
        restock: restock,
    });
};
