// =====================================================================
// roles/workshop/dismantle.js - dismantling spare drop copies into their material.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    // ---- dismantling (config.dismantle, player decision 2026-11-17) ------------------
    //
    // Spare drop weapons are not upgraded but dismantled at Leo into their material (a
    // fire weapon gives one Essence of Fire). The material stacks in one bank slot and
    // weapons are crafted from it on demand - Phoenix nights no longer fill the bank.
    function dismantleOn(name) {
        const d = config.dismantle;
        return !!(d && d.enabled && (d.names || []).includes(name) && G.dismantle && G.dismantle[name]);
    }
    // Units we hold (bag + last bank snapshot).
    // level (optional): only copies at exactly that level, and only unlocked ones in the bag.
    function ownedCount(name, level) {
        const at = function (l) { return level === undefined || (l || 0) === level; };
        const bag = character.items.reduce(function (s, i) { return i && i.name === name && at(i.level) && (level === undefined || !i.l) ? s + (i.q || 1) : s; }, 0);
        const bank = wks.bankSnapshot ? wks.bankSnapshot.items.reduce(function (s, b) { return b.name === name && at(b.level) ? s + (b.q || 1) : s; }, 0) : 0;
        return bag + bank;
    }
    // A bag item or bank entry we may dismantle now.
    function isDismantleCopy(item) {
        if (!item || !dismantleOn(item.name) || item.l || item.p) return false;
        if ((item.level || 0) > (config.dismantle.maxLevel || 0)) return false;
        // A material goal waiting for a higher priority: its +0 copies become material even though a wish or
        // a weapon list wants them (material goals, 2026-11-22).
        const deferred = wks.materialDeferred(item.name);
        if (!deferred && (wks.isReserved(item) || wks.isOwnWish(item.name))) return false;
        // A material goal wants this item: the copy is its next base.
        if (wks.materialProtects(item.name)) return false;
        // betterWeapons readies a copy of it for a fighter: those copies are needed.
        if (!deferred && wks.weaponPlans().some(function (p) { return p.name === item.name; })) return false;
        // Bought on purpose (config.market.buy): copies up to "want" stay.
        const order = ((config.market || {}).buy || []).find(function (o) { return o.item === item.name; });
        if (order && ownedCount(item.name) <= (order.want || 0)) return false;
        return true;
    }
    async function dismantleDrops() {
        if (!config.dismantle || !config.dismantle.enabled) return false;
        if ((wks.blockedUntil._dismantle || 0) > Date.now()) return false;
        const inBag = function () { return character.items.findIndex(function (i) { return isDismantleCopy(i); }); };
        const banked = wks.bankSnapshot ? wks.bankSnapshot.items.filter(isDismantleCopy) : [];
        if (inBag() === -1 && !banked.length) return false;
        const reserve = util.goldAmount(config.merchantRole.goldReserve);
        try {
            // Bank copies first, as many as the bag takes in one visit.
            for (const b of banked) {
                if (character.esize < 4) break;
                await wks.retrieve(b);
            }
            // Nothing came out (bag nearly full, 2026-11-22 review): no dismantling this round - returning true
            // here kept the rest of the workshop waiting until the bag freed up.
            if (inBag() === -1) return false;
            let index;
            while ((index = inBag()) !== -1) {
                const item = character.items[index];
                const cost = G.dismantle[item.name].cost || 0;
                if (character.gold - cost < reserve) throw { reason: "gold below the reserve" };
                util.status("dismantling " + item.name, "orange");
                await wks.goTo("craftsman");
                index = inBag(); // the walk may have taken a while: locate it again
                if (index === -1) break;
                const name = character.items[index].name, level = character.items[index].level || 0;
                await dismantle(index);
                util.log("workshop", "dismantled " + name + " +" + level + " into " +
                    G.dismantle[name].items.map(function (it) { return it[0] + "x " + it[1]; }).join(", "), "green");
            }
        } catch (e) {
            util.log("workshop", "dismantling: " + util.errReason(e), "orange");
            wks.blockedUntil._dismantle = Date.now() + cfg.giveUpForMs;
        }
        return true;
    }

    Object.assign(wks, {
        dismantleOn: dismantleOn,
        ownedCount: ownedCount,
        isDismantleCopy: isDismantleCopy,
        dismantleDrops: dismantleDrops,
    });
};
