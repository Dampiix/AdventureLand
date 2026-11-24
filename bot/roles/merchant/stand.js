// =====================================================================
// roles/merchant/stand.js - the market stand: buy and sell orders, filled orders, keeping it open.
// Part of bot_merchant (module plan, stage 6b): moved from the old single-file roles/merchant.js (verbatim; since then the whileWished buy orders, 2026-11-25). The parts
// share one internal state (mer: pickup requests, trips, the stand, timers) and call each other through mer;
// outside dependencies come in deps (config, util, comms, workshop).
// =====================================================================

module.exports = function install(mer, deps) {
    const config = deps.config;
    const util = deps.util;
    const m = config.merchantRole;
    const workshop = deps.workshop;
    const st = m.stand || {};

    function standIndex() {
        return util.findItemIndex(function (i) { return G.items[i.name] && G.items[i.name].type === "stand"; });
    }
    function useStand() {
        return !!st.enabled && !!st.home && standIndex() !== -1;
    }
    function bagCount(name, level) {
        let n = 0;
        character.items.forEach(function (i) { if (i && i.name === name && (i.level || 0) === level) n += i.q || 1; });
        return n;
    }
    function checkFills() {
        const now = Date.now();
        if (!mer.standSince || now - mer.standSince < 5000) return; // trade slots still coming back
        Object.keys(mer.watched).forEach(function (s) {
            const w = mer.watched[s];
            const it = character.slots[s];
            const same = it && it.b && it.name === w.name && (it.level || 0) === w.level && it.price === w.price;
            const left = same ? (it.q || 1) : 0;
            if (left >= w.q) { w.bag = bagCount(w.name, w.level); return; }
            const n = w.q - left;
            if (left) w.q = left; else delete mer.watched[s];
            mer.pendingFills.push({ name: w.name, level: w.level, price: w.price, n: n, base: w.bag, until: now + 15000 });
        });
        for (let i = mer.pendingFills.length - 1; i >= 0; i--) {
            const p = mer.pendingFills[i];
            if (bagCount(p.name, p.level) >= p.base + p.n) {
                mer.pendingFills.splice(i, 1);
                workshop.bookWishFill(p.name, p.level, p.price, p.n);
            } else if (now > p.until) {
                mer.pendingFills.splice(i, 1);
                util.log("merchant", "wish order " + p.name + " +" + p.level + " left the stand without the item - not booked", "white");
            }
        }
        // Listings the server confirmed (they carry a price; our claim right after listing doesn't).
        Object.keys(character.slots || {}).forEach(function (s) {
            const it = character.slots[s];
            if (!/^trade\d+$/.test(s) || mer.watched[s] || !it || !it.b || !it.price) return;
            if (mer.wishKeys[it.name + "|" + (it.level || 0)]) mer.watched[s] = { name: it.name, level: it.level || 0, price: it.price, q: it.q || 1, bag: bagCount(it.name, it.level || 0) };
        });
    }
    // Open the stand at home and keep the buy orders listed (exact name and level).
    function keepStand() {
        if (!useStand() || !mer.atHome()) return;
        if (!character.stand) {
            mer.standSince = 0;
            try {
                util.openStand(standIndex());
            } catch (e) { util.log("merchant", "opening the stand failed: " + util.errReason(e), "orange"); }
            mer.nextOrdersAt = Date.now() + 2000; // let the trade slots appear first
            return;
        }
        if (!mer.standSince) mer.standSince = Date.now();
        if (workshop.bookWishFill) checkFills();
        if (Date.now() < mer.nextOrdersAt) return;
        // Orders count bag + bank: right after a restart the bank is not read yet, and a
        // buy order for 4 green Lolipops went up with 26 of them in the bank (2026-11-17).
        if (!workshop.bankKnown()) return;
        mer.nextOrdersAt = Date.now() + 60 * 1000;
        // An open stand has 16 trade slots (24 from merchant level 70, 30 from 80 - server);
        // empty ones are not listed in character.slots, so the names are built here.
        const count = character.level >= 80 ? 30 : character.level >= 70 ? 24 : 16;
        const slots = [];
        for (let i = 1; i <= count; i++) slots.push("trade" + i);
        const market = config.market || {};
        const lvlText = function (name, level) { return G.items[name].upgrade || G.items[name].compound ? " +" + level : ""; };
        // Configured orders plus orders for what the fighters wish (market.wishOrders, 2026-11-19).
        const wishOrders = workshop.wishBuyOrders ? workshop.wishBuyOrders() : [];
        const buys = (market.buy || []).concat(wishOrders);
        mer.wishKeys = {};
        wishOrders.forEach(function (o) { mer.wishKeys[o.item + "|" + (o.level || 0)] = true; });
        // whileWished (2026-11-25): the order stands only while some fighter wishes the item (the green Lolipops are a
        // stand-in for the orange ones; once nobody wishes them they are sold, so buying more would be a loss).
        const wished = function (o) { return !o.whileWished || workshop.isReserved({ name: o.item, level: o.level || 0 }); };
        const stillNeeded = function (o) {
            if (!wished(o)) return false;
            return o.dynamic ? workshop.needsCopy(o.item, o.level || 0) : (o.want || 1) - workshop.ownedCount(o.item) > 0;
        };
        const samePrice = function (o, listed) {
            return o.dynamic ? Math.abs(listed - o.price) <= o.price * 0.2 : listed === o.price;
        };
        // Listed buy orders no longer needed - the item left config.market.buy, or we hold
        // "want" by now - are taken down (unequip removes the listing). So is one whose price
        // differs from the config (an orange Lolipop order from an old config sat at 50k for
        // days, 2026-11-18); the next pass lists it again at the current price.
        slots.forEach(function (s) {
            const it = character.slots[s];
            if (!it || !it.b) return;
            const o = buys.find(function (b) { return b.item === it.name && (b.level || 0) === (it.level || 0); });
            const needed = o && stillNeeded(o);
            if (needed && samePrice(o, it.price)) return;
            delete mer.watched[s]; // taken down by us, not sold to
            parent.socket.emit("unequip", { slot: s });
            const why = !o ? "not on the list"
                : !needed ? (!wished(o) ? "nobody wishes it" : "we hold " + workshop.ownedCount(o.item) + " of " + (o.want || 1))
                : "price " + it.price + " -> " + o.price + ", listed again";
            util.log("merchant", "buy order for " + it.name + " taken down (" + why + ")", "white");
        });
        // Sell listings of config.market.sell items at an old price (2026-11-22 review: only buy orders were
        // checked, so a changed sell price never reached the stand). Taken down; the sell pass below lists them
        // again at the current price. Listings of items not on the sell list are left alone (they may be ours by hand).
        slots.forEach(function (s) {
            const it = character.slots[s];
            if (!it || it.b || !it.price) return;
            const o = (market.sell || []).find(function (x) { return x.item === it.name && (x.level || 0) === (it.level || 0); });
            if (!o || it.price === o.price) return;
            delete mer.watched[s]; // taken down by us, not sold
            parent.socket.emit("unequip", { slot: s });
            util.log("merchant", "sell listing for " + it.name + " taken down (price " + it.price + " -> " + o.price + ", listed again)", "white");
        });
        // Buy orders: what is missing up to "want" (bag + bank).
        buys.forEach(function (o) {
            if (!G.items[o.item]) return;
            const level = o.level || 0;
            const listed = slots.some(function (s) {
                const it = character.slots[s];
                return it && it.b && it.name === o.item && (it.level || 0) === level;
            });
            if (listed || character.gold < o.price) return; // a buy order must be funded
            const missing = !wished(o) ? 0 : o.dynamic ? (stillNeeded(o) ? 1 : 0) : (o.want || 1) - workshop.ownedCount(o.item);
            if (missing <= 0) { delete mer.missingSince[o.item]; return; }
            // Only a shortage that lasts: while the workshop moves a stack between bag and bank
            // (crafting from 85 essences) the count read 0 for a moment and a buy order for 10
            // went up (2026-11-18).
            if (!mer.missingSince[o.item]) mer.missingSince[o.item] = Date.now();
            if (Date.now() - mer.missingSince[o.item] < 2 * 60 * 1000) return;
            const free = slots.find(function (s) { return !character.slots[s]; });
            if (!free) return;
            character.slots[free] = { name: o.item, b: true }; // claimed until the server answers
            parent.socket.emit("trade_wishlist", { slot: free, name: o.item, level: level, q: missing, price: o.price });
            util.log("merchant", "buy order: " + missing + "x " + o.item + lvlText(o.item, level) + " at " + o.price, "white");
        });
        // Sell orders: everything above "keep", from the bag (bank items come on the next
        // bank trip). One listing per item at a time; a stack goes in with its surplus.
        (market.sell || []).forEach(function (o) {
            if (!G.items[o.item]) return;
            const level = o.level || 0;
            const listed = slots.some(function (s) {
                const it = character.slots[s];
                return it && !it.b && it.name === o.item && (it.level || 0) === level;
            });
            if (listed) return;
            const surplus = workshop.ownedCount(o.item) - (o.keep || 0);
            if (surplus <= 0) return;
            const idx = util.findItemIndex(function (i) {
                return i.name === o.item && (i.level || 0) === level && !i.l && !i.p && !workshop.isReserved(i);
            });
            if (idx === -1) return;
            const free = slots.find(function (s) { return !character.slots[s]; });
            if (!free) return;
            const item = character.items[idx];
            // max (2026-11-20): only part of the surplus at the stand - Monster Tokens go into
            // other players' buy orders as well (market.sellTo), which only sees bag + bank.
            const q = Math.min(surplus, item.q || 1, o.max || Infinity);
            character.slots[free] = { name: o.item, price: o.price }; // claimed until the server answers
            trade(idx, free, o.price, q);
            util.log("merchant", "sell order: " + q + "x " + o.item + lvlText(o.item, level) + " at " + o.price, "white");
        });
    }
    // Surplus of a market sell item (above "keep"), counted over bag and bank (workshop.ownedCount;
    // listings not included).
    function marketSurplus(name, level) {
        const o = ((config.market || {}).sell || []).find(function (s) { return s.item === name && (s.level || 0) === (level || 0); });
        return o ? workshop.ownedCount(name) - (o.keep || 0) : 0;
    }

    Object.assign(mer, {
        standIndex: standIndex,
        useStand: useStand,
        bagCount: bagCount,
        checkFills: checkFills,
        keepStand: keepStand,
        marketSurplus: marketSurplus,
    });
};
