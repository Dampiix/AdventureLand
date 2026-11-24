// =====================================================================
// roles/merchant/sell-to.js - selling into other players' buy orders and buying from their stands (trade trips).
// Part of bot_merchant (module plan, stage 6b): moved verbatim from the old single-file roles/merchant.js. The parts
// share one internal state (mer: pickup requests, trips, the stand, timers) and call each other through mer;
// outside dependencies come in deps (config, util, comms, workshop).
// =====================================================================

module.exports = function install(mer, deps) {
    const config = deps.config;
    const util = deps.util;
    const m = config.merchantRole;
    const workshop = deps.workshop;
    const prc = m.pontyRound || {};
    const stc = (config.market && config.market.sellTo) || {};

    function scanAgainIn(ms) {
        mer.nextSellScanAt = Date.now() + ms;
        try { set(mer.NEXT_SCAN_KEY, mer.nextSellScanAt); } catch (e) { /* storage unavailable */ }
    }
    function readTrip() { try { return get(mer.TRIP_KEY) || null; } catch (e) { return null; } }
    function saveTrip(t) { try { set(mer.TRIP_KEY, t || null); } catch (e) { /* storage unavailable */ } }
    async function pullMerchants() {
        const r = await parent.fetch("/api/pull_merchants", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: "{}" });
        const data = await r.json();
        const m = ((data && data.infs) || []).find(function (x) { return x && x.type === "merchants"; });
        return (m && m.chars) || [];
    }
    function serverName(key) { // "SR_EUIII" -> "EU III"
        const mm = /^SR_(EU|US|ASIA)(.+)$/.exec(String(key || ""));
        return mm ? mm[1] + " " + mm[2] : null;
    }
    function markFailed(key, failed) {
        if (failed) mer.failedOffers[key] = Date.now(); else delete mer.failedOffers[key];
        try { set(mer.FAILED_KEY, mer.failedOffers); } catch (e) { /* storage unavailable */ }
    }
    function offerKey(seller, item, level) { return seller + "|" + item + "|" + level; }
    // A stand we just walked to may take a moment to show up.
    // Seen but not where the merchant list put the stand: walk up to where it really is - the
    // server trades only within a short distance (2026-11-20: "selling to Rocky: distance", the
    // list said 0,0).
    async function waitForPlayer(name) {
        for (let i = 0; i < 25; i++) {
            const p = get_player(name);
            if (p) {
                if (util.distanceTo(p) > 150) {
                    try { await util.walk({ map: character.map, x: p.x, y: p.y }); } catch (e) { /* checked by the trade */ }
                    return get_player(name) || p;
                }
                return p;
            }
            await sleep(200);
        }
        return null;
    }
    function bestBuyDeal(chars) {
        if (!stc.buyFromPlayers) return null;
        const offers = workshop.playerOffers(chars);
        for (const o of offers) {
            const server = serverName(o.char.server);
            if (!server) continue;
            if (Date.now() - (mer.failedOffers[offerKey(o.char.name, o.name, o.level)] || 0) < 30 * 60 * 1000) continue;
            return { kind: "buy", server: server, seller: o.char.name, map: o.char.map, x: o.char.x, y: o.char.y,
                item: o.name, level: o.level, price: o.price, slot: o.slot, q: 1,
                offer: { kind: o.kind, fighter: o.fighter || null, own: o.own || null, gain: o.gain || null } };
        }
        return null;
    }
    function scanBuyOrders(chars) {
        const items = (stc.items || []).filter(function (s) { return G.items[s.item]; });
        if (!items.length) return null;
        const home = mer.homeName();
        let best = null;
        chars.forEach(function (c) {
            if (!c || c.name === character.name || !c.slots || !c.stand) return; // stand closed: away
            const server = serverName(c.server);
            if (!server) return;
            Object.keys(c.slots).forEach(function (s) {
                const it = c.slots[s];
                if (!it || !it.b) return;
                const level = it.level || 0;
                // A rule per item level (2026-11-20: Vitality earrings +0 and +2).
                const rule = items.find(function (x) { return x.item === it.name && (x.level || 0) === level; });
                if (!rule || it.price < rule.minPrice) return;
                mer.demand[it.name + ":" + level] = Date.now(); // a buyer at our price exists (workshop: hold the copies)
                if (Date.now() - (mer.failedOffers[offerKey(c.name, it.name + (level ? "+" + level : ""), "sell")] || 0) < 30 * 60 * 1000) return;
                const surplus = workshop.ownedCount(it.name, level) - (rule.keep || 0);
                const q = Math.min(surplus, it.q || 1);
                if (q <= 0) return;
                const better = !best || it.price > best.price || (it.price === best.price && server === home && best.server !== home);
                if (better) best = { kind: "sell", server: server, buyer: c.name, map: c.map, x: c.x, y: c.y, item: it.name, level: level, price: it.price, q: q };
            });
        });
        saveDemand();
        return best;
    }
    function saveDemand() {
        if (!mer.demand._since) mer.demand._since = Date.now(); // tracking started: nothing seen before counts as unknown
        try { set(mer.DEMAND_KEY, mer.demand); } catch (e) { /* storage unavailable */ }
    }
    // The largest single unlocked stack of name +level in the bag.
    function biggestStack(name, level) {
        return character.items.reduce(function (m, i) {
            return i && i.name === name && (i.level || 0) === level && !i.l ? Math.max(m, i.q || 1) : m;
        }, 0);
    }
    // Usable copies of name at exactly level in the bag (the server sells unlocked ones only).
    function countAt(name, level) {
        return character.items.reduce(function (s, i) {
            return i && i.name === name && (i.level || 0) === level && !i.l ? s + (i.q || 1) : s;
        }, 0);
    }
    // True while a sell trip holds the merchant.
    async function tradeTrip() {
        if (!stc.enabled) return false;
        const here = mer.hereName(), home = mer.homeName();
        let t = readTrip();
        if (!t) {
            if (here !== home || mer.readRound() || Date.now() < mer.nextSellScanAt) return false;
            scanAgainIn((stc.scanEveryMs || 5 * 60 * 1000));
            let chars = [];
            try { chars = await pullMerchants(); } catch (e) { util.log("merchant", "merchant list: " + util.errReason(e), "orange"); return false; }
            // Selling first (gold in), then the best offer to buy.
            const deal = scanBuyOrders(chars) || bestBuyDeal(chars);
            if (!deal) return false;
            t = { phase: "fetch", deal: deal, at: Date.now(), beat: Date.now() };
            saveTrip(t);
            if (deal.kind === "buy") util.log("merchant", "offer found: " + deal.seller + " (" + deal.server + ") sells " + deal.item + " +" + deal.level + " for " + Math.round(deal.price / 1000) + "k (" + deal.offer.kind + (deal.offer.fighter ? " for " + deal.offer.fighter : "") + ") - buying", "yellow");
            else util.log("merchant", "buy order found: " + deal.buyer + " (" + deal.server + ") pays " + Math.round(deal.price / 1000) + "k for " + deal.item + (deal.level ? " +" + deal.level : "") + " - selling " + deal.q, "yellow");
        }
        t.beat = Date.now();
        const d = t.deal;
        if (t.phase === "fetch" && d.kind === "buy") {
            if (character.gold < d.price || character.esize < 1) { util.log("merchant", "no gold or room for " + d.item + " - not buying", "orange"); saveTrip(null); return false; }
            t.phase = d.server === here ? "sell" : "travel";
            t.at = Date.now();
            saveTrip(t);
            if (t.phase === "travel") mer.requestHop(d.server);
            return true;
        }
        if (t.phase === "fetch") {
            // The surplus into the bag (bank first); then off to the buyer.
            const lvl = d.level || 0;
            // Always through the bank: a fresh read there is the only reliable count - the scan's
            // surplus came from a snapshot that may still list what is already in the bag (review
            // 2026-11-20: the kept tokens could go).
            if (await util.walkToBank()) {
                if (workshop.refreshBank) workshop.refreshBank();
                for (const pack of Object.keys(character.bank || {})) {
                    if (!/^items\d+$/.test(pack)) continue;
                    const list = character.bank[pack] || [];
                    for (let i = 0; i < list.length && countAt(d.item, lvl) < d.q; i++) {
                        if (character.esize < 1) break;
                        if (list[i] && list[i].name === d.item && (list[i].level || 0) === lvl) { try { await bank_retrieve(pack, i); } catch (e) { /* next one */ } }
                    }
                }
                if (workshop.refreshBank) workshop.refreshBank();
                const rule = (stc.items || []).find(function (x) { return x.item === d.item && (x.level || 0) === lvl; }) || {};
                d.q = Math.min(d.q, workshop.ownedCount(d.item, lvl) - (rule.keep || 0));
            } else d.q = 0; // no fresh count: not this time
            d.q = Math.min(d.q, countAt(d.item, lvl));
            if (d.q <= 0) { util.log("merchant", "no " + d.item + " to sell after all", "orange"); saveTrip(null); return false; }
            t.phase = d.server === here ? "sell" : "travel";
            t.at = Date.now();
            saveTrip(t);
            if (t.phase === "travel") mer.requestHop(d.server);
            return true;
        }
        if (t.phase === "travel") {
            if (here === d.server) { t.phase = "sell"; t.at = Date.now(); saveTrip(t); return true; }
            if (Date.now() - t.at > (prc.hopTimeoutMs || 2 * 60 * 1000)) { t.at = Date.now(); mer.requestHop(d.server); }
            saveTrip(t);
            return true;
        }
        if (t.phase === "sell" && d.kind === "buy") {
            util.status("buying from " + d.seller, "yellow");
            try { await util.walk({ map: d.map, x: d.x, y: d.y }); } catch (e) { /* checked below */ }
            const seller = await waitForPlayer(d.seller);
            // Not at the stand (merchants walk to their fighters): no block, it is tried again
            // when the merchant list shows the stand open (player decision 2026-11-20). Any
            // other failure blocks the offer for 30 min; a purchase clears it.
            if (seller) markFailed(offerKey(d.seller, d.item, d.level), true);
            if (!seller) {
                util.log("merchant", d.seller + " not at the stand - no purchase, trying again later", "orange");
                scanAgainIn((stc.scanEveryMs || 5 * 60 * 1000));
            } else {
                // The listed slot, or the same item elsewhere on the stand - never dearer than planned.
                const ok = function (s) { const it = seller.slots && seller.slots[s]; return it && !it.b && it.name === d.item && (it.level || 0) === d.level && it.price <= d.price; };
                const slot = ok(d.slot) ? d.slot : Object.keys(seller.slots || {}).find(ok);
                if (!slot) util.log("merchant", d.seller + " no longer sells " + d.item + " +" + d.level + " at that price", "orange");
                else {
                    const price = seller.slots[slot].price;
                    try {
                        await trade_buy(seller, slot, 1);
                        markFailed(offerKey(d.seller, d.item, d.level), false);
                        workshop.bookPlayerBuy(Object.assign({}, d.offer, { name: d.item, level: d.level, price: price, seller: d.seller, server: here }));
                        util.log("merchant", "bought " + d.item + " +" + d.level + " from " + d.seller + " (" + here + ") for " + Math.round(price / 1000) + "k", "green");
                        try { const log = get("bot_trade_log") || []; set("bot_trade_log", log.concat([{ at: Date.now(), kind: "buy", server: here, seller: d.seller, item: d.item, level: d.level, q: 1, price: price }]).slice(-100)); } catch (e) { /* log only */ }
                    } catch (e) { util.log("merchant", "buying from " + d.seller + ": " + util.errReason(e), "orange"); }
                }
            }
            // No quick follow-up scan after a purchase any more (2026-11-20): the next one comes with
            // the normal interval, so the merchant gets on with its work between trips.
            t.phase = here === home ? "done" : "home";
            t.at = Date.now();
            saveTrip(t.phase === "done" ? null : t);
            if (t.phase === "home") mer.requestHop(home);
            return t.phase === "home";
        }
        if (t.phase === "sell") {
            util.status("selling to " + d.buyer, "yellow");
            try { await util.walk({ map: d.map, x: d.x, y: d.y }); } catch (e) { /* checked below */ }
            const buyer = await waitForPlayer(d.buyer);
            let sold = 0, goldShort = false;
            if (!buyer) {
                util.log("merchant", d.buyer + " not at the stand - no sale, trying again later", "orange");
                scanAgainIn(stc.scanEveryMs || 5 * 60 * 1000);
            }
            else {
                const lvl = d.level || 0;
                const rule = (stc.items || []).find(function (x) { return x.item === d.item && (x.level || 0) === lvl; }) || {};
                const slot = Object.keys(buyer.slots || {}).find(function (s) {
                    const it = buyer.slots[s];
                    return it && it.b && it.name === d.item && (it.level || 0) === lvl && it.price >= (rule.minPrice || d.price);
                });
                // Not stackable (earrings): the server sells one item per call (q <= the item's q).
                const stacks = !!(G.items[d.item] && G.items[d.item].s);
                if (!slot) util.log("merchant", d.buyer + " no longer buys " + d.item + (lvl ? " +" + lvl : "") + " at our price", "orange");
                else {
                    // d.q is the surplus above "keep", counted before the trip (bag + bank).
                    // The server refuses the whole sale when the buyer can't pay all of it
                    // ("buyer_gold"): then half as many, again, down to one - and after each sale
                    // the next portion of that size until the buyer is out of gold (2026-11-20).
                    let remaining = Math.min(d.q, buyer.slots[slot].q || 1);
                    let chunk = remaining, gold = 0;
                    const price = buyer.slots[slot].price;
                    while (remaining > 0 && chunk >= 1) {
                        const b = get_player(d.buyer);
                        const cur = b && b.slots && b.slots[slot];
                        if (!cur || !cur.b || cur.name !== d.item || (cur.level || 0) !== lvl || cur.price < (rule.minPrice || d.price)) break;
                        // The server sells from ONE bag stack holding the whole amount (review 2026-11-20).
                        const c = stacks ? Math.min(chunk, remaining, cur.q || 1, biggestStack(d.item, lvl)) : Math.min(1, countAt(d.item, lvl));
                        if (c <= 0) break;
                        try {
                            await trade_sell(b, slot, c);
                            sold += c;
                            remaining -= c;
                            gold += cur.price * c;
                        } catch (e) {
                            const why = util.errReason(e);
                            if (why === "buyer_gold") { goldShort = true; chunk = Math.floor(c / 2); continue; }
                            util.log("merchant", "selling to " + d.buyer + ": " + why, "orange");
                            break;
                        }
                        await sleep(400); // let the buyer's slot update
                    }
                    if (sold) {
                        util.log("merchant", "sold " + sold + "x " + d.item + (lvl ? " +" + lvl : "") + " to " + d.buyer + " for " + Math.round(gold / 1000) + "k" + (remaining > 0 ? " (" + remaining + " more than it could pay)" : ""), "green");
                        try { const log = get("bot_trade_log") || []; set("bot_trade_log", log.concat([{ at: Date.now(), server: here, buyer: d.buyer, item: d.item, level: lvl, q: sold, price: price }]).slice(-100)); } catch (e) { /* log only */ }
                    } else if (chunk < 1) util.log("merchant", d.buyer + " can't pay even one " + d.item, "orange");
                }
            }
            // Nothing sold, or the buyer ran out of gold before taking everything: not this buyer for
            // 30 min (player decision 2026-11-20 - no hop to Rocky every 5 min for one token).
            // A buyer away from its stand is not blocked (it walks to its fighters, 2026-11-20).
            if (buyer) markFailed(offerKey(d.buyer, d.item + (d.level ? "+" + d.level : ""), "sell"), sold === 0 || goldShort);
            t.phase = here === home ? "done" : "home";
            t.at = Date.now();
            saveTrip(t.phase === "done" ? null : t);
            if (t.phase === "home") mer.requestHop(home);
            return t.phase === "home";
        }
        if (t.phase === "home") {
            if (here === home) { saveTrip(null); util.log("merchant", "sell trip done", "green"); return false; }
            if (Date.now() - t.at > (prc.hopTimeoutMs || 2 * 60 * 1000)) { t.at = Date.now(); mer.requestHop(home); }
            saveTrip(t);
            return true;
        }
        saveTrip(null);
        return false;
    }

    Object.assign(mer, {
        scanAgainIn: scanAgainIn,
        readTrip: readTrip,
        saveTrip: saveTrip,
        pullMerchants: pullMerchants,
        serverName: serverName,
        markFailed: markFailed,
        offerKey: offerKey,
        waitForPlayer: waitForPlayer,
        bestBuyDeal: bestBuyDeal,
        scanBuyOrders: scanBuyOrders,
        saveDemand: saveDemand,
        biggestStack: biggestStack,
        countAt: countAt,
        tradeTrip: tradeTrip,
    });
};
