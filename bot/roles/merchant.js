// =====================================================================
// bot_merchant – the merchant supports the fighters.
//
// Idle (in town near the potion shop):
//   - sell items from config.merchantRole.sellList (shiny and locked
//     items never; upgraded ones only up to the entry's maxLevel)
//   - bag running full -> store everything else in the bank
//     (config.merchantRole.bank), never buying new bank packs
//   - keep a potion stock (config.merchantRole.stock), never spending
//     below goldReserve
//   - work on the fighters' equipment wishes (bot_workshop)
// Delivery (a fighter sent a "pickup" request):
//   - top up the stock, walk to the fighter
//   - send the potions it asked for, gifts and finished wishes,
//     cast Merchant's Luck on it
//   - wait a moment: the fighter hands over loot and surplus gold
//   - walk back to town
// =====================================================================

module.exports = function createMerchant(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const m = config.merchantRole;
    const workshop = ctx.workshop;

    const requests = new Map(); // fighter name -> latest pickup request
    let running = false;
    let busy = false;
    let nextChoresAt = 0;     // selling/restocking runs at most every 30 s
    let lastRespawnTry = 0;

    comms.on("pickup", function (data, from) {
        const isNew = !requests.has(from);
        requests.set(from, Object.assign({}, data, { at: Date.now() }));
        if (isNew) util.log("merchant", "pickup requested by " + from, "yellow");
        comms.send(from, "coming", {});
    });

    function survive() {
        if (is_on_cooldown("use_hp")) return;
        if (util.hpRatio() < 0.5) use_skill("use_hp").catch(function () {});
        else if (util.mpRatio() < 0.2) use_skill("use_mp").catch(function () {});
    }

    function atHome() {
        const shop = (G.maps.main.npcs || []).find(function (n) { return n.id === "fancypots"; });
        return character.map === "main" && shop && util.distanceTo({ x: shop.position[0], y: shop.position[1] }) < 200;
    }

    async function goHome() {
        if (atHome()) return;
        util.status("going to town", "yellow");
        await smart_move({ to: "potions" });
    }

    // sellList entries: "name" (only +0) or { name, maxLevel }.
    function sellRule(name) {
        for (const entry of m.sellList) {
            if (entry === name) return { maxLevel: 0 };
            if (entry && entry.name === name) return { maxLevel: entry.maxLevel || 0 };
        }
        return null;
    }

    function isSellable(item) {
        const rule = sellRule(item.name);
        if (!rule || item.p || item.l) return false; // shiny / locked never
        if (workshop.isReserved(item)) return false;  // a fighter wishes for it
        return (item.level || 0) <= rule.maxLevel;
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

    // Buy potions up to `wanted` (defaults to the configured stock).
    async function restock(wanted) {
        for (const name of Object.keys(m.stock)) {
            const target = Math.max(m.stock[name], (wanted && wanted[name]) || 0);
            const missing = target - util.countItem(name);
            if (missing <= 0) continue;
            const price = G.items[name].g;
            const affordable = Math.floor(Math.max(0, character.gold - m.goldReserve) / price);
            const amount = Math.min(missing, affordable);
            if (amount <= 0) {
                util.log("merchant", "not enough gold above the reserve for " + name, "red");
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

    async function giveTo(name, want) {
        for (const potion of Object.keys(want || {})) {
            let missing = want[potion];
            while (missing > 0) {
                const index = util.findItemIndex(function (i) { return i.name === potion; });
                if (index === -1) break;
                const amount = Math.min(missing, character.items[index].q || 1);
                await send_item(name, index, amount);
                missing -= amount;
            }
        }
    }

    // One-off items from config.merchantRole.give – sent once, because afterwards
    // they are no longer in our bag.
    async function giveGifts(name) {
        for (const itemName of (m.give && m.give[name]) || []) {
            const index = util.findItemIndex(function (i) { return i.name === itemName; });
            if (index === -1) continue;
            await send_item(name, index, 1);
            util.log("merchant", "gave " + itemName + " to " + name, "green");
        }
    }

    async function deliver(name) {
        const req = requests.get(name);
        util.status("delivering to " + name, "orange");
        try {
            if (atHome()) await restock(req.want);
            await smart_move({ map: req.map, x: req.x, y: req.y });

            // The fighter may have moved on: follow it once if it is visible.
            let fighter = get_player(name);
            if (fighter && !util.isNear(fighter, 200)) {
                const p = util.xy(fighter);
                await smart_move({ map: character.map, x: p.x, y: p.y });
                fighter = get_player(name);
            }
            if (!fighter || !util.isNear(fighter, 250)) {
                util.log("merchant", name + " not found at the pickup spot - waiting for a new request", "orange");
                return;
            }

            await giveTo(name, (requests.get(name) || req).want);
            await giveGifts(name);
            await workshop.handOver(name);
            if (util.canCast("mluck")) use_skill("mluck", name).catch(function () {});
            util.status("collecting from " + name, "orange");
            await sleep(m.handoverWaitMs); // the fighter hands over loot and gold while we stand here
            util.log("merchant", "pickup for " + name + " done", "green");
        } catch (e) {
            util.log("merchant", "delivery to " + name + " failed: " + util.errReason(e), "red");
        } finally {
            requests.delete(name);
        }
    }

    // Everything that is neither sold, kept, part of the potion stock nor a gift.
    function isBankable(item) {
        if (!item || isSellable(item) || workshop.isReserved(item)) return false;
        if (m.stock[item.name] !== undefined) return false;
        if (m.bank.keep.includes(item.name)) return false;
        const gifts = [].concat.apply([], Object.values(m.give || {}));
        return !gifts.includes(item.name);
    }

    // Walk into the bank and store what we can. Returns the number of stacks stored.
    async function bankTrip() {
        util.status("banking", "yellow");
        await smart_move("bank");
        let stored = 0;
        let full = false;
        // Walk the bag once from the end; each index is checked right before storing.
        for (let index = character.items.length - 1; index >= 0; index--) {
            const item = character.items[index];
            if (!isBankable(item)) continue;
            try {
                await bank_store(index); // auto placement, merges into existing stacks
                stored++;
            } catch (e) {
                if (util.errReason(e) === "bank_full") full = true; // stackable items may still fit – keep going
                else util.log("merchant", "could not bank " + item.name + ": " + util.errReason(e), "orange");
            }
        }
        util.log("merchant", "banked " + stored + " stacks" + (full ? " - bank is full, a new pack is needed" : ""), full ? "orange" : "green");
        return stored;
    }

    let nextBankTripAt = 0;
    async function bankIfNeeded() {
        if (character.esize >= m.bank.whenFreeBelow || Date.now() < nextBankTripAt) return;
        if (!character.items.some(isBankable)) return;
        const stored = await bankTrip();
        // Nothing fit: don't run back and forth – try again in 10 minutes.
        nextBankTripAt = Date.now() + (stored ? 60 * 1000 : 10 * 60 * 1000);
    }

    async function work() {
        if (busy) return;
        busy = true;
        try {
            const next = requests.keys().next();
            if (!next.done) {
                await deliver(next.value);
                await goHome();
                return;
            }
            await goHome();
            if (Date.now() >= nextChoresAt) {
                nextChoresAt = Date.now() + 30 * 1000;
                await sellJunk();
                await bankIfNeeded();
                await workshop.work();
                await goHome();
                await restock();
            }
            util.status("ready in town", "white");
        } catch (e) {
            util.log("merchant", "work failed: " + util.errReason(e), "red");
            await sleep(5000);
        } finally {
            busy = false;
        }
    }

    async function loop() {
        running = true;
        util.log("bot", "merchant started", "green");
        while (running) {
            try {
                if (character.rip) {
                    if (Date.now() - lastRespawnTry > 5000) {
                        lastRespawnTry = Date.now();
                        respawn().catch(function () {});
                    }
                } else {
                    survive();
                    work();
                }
            } catch (e) {
                util.log("bot", "tick error: " + util.errReason(e), "red");
            }
            await sleep(1000);
        }
    }

    return {
        start: function () { loop(); },
        stop: function () { running = false; },
    };
};
