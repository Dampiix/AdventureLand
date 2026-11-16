// =====================================================================
// bot_supply – fighter side of potions, loot and gold.
//
// - Merchant next to us?        -> hand over loot and surplus gold
// - Low on potions / bag full / routine interval -> ask the merchant
//   for a pickup (CODE message with our position and what we need)
// - Merchant silent and potions almost gone -> walk to town and buy
//
// tick() returns "busy" while a self-resupply trip is running so the
// fighter skips combat during that time.
// =====================================================================

module.exports = function createSupply(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const p = config.potions;
    const s = config.supply;
    const merchant = config.merchant && config.characters[config.merchant] ? config.merchant : null;

    let busy = false;          // self-resupply trip running
    let handingOver = false;   // sending items/gold right now
    let lastRequest = 0;
    let pendingSince = 0;      // first unanswered request
    // First routine pickup shortly after start, then every pickupEveryMs.
    let lastPickup = Date.now() - s.pickupEveryMs + s.firstPickupAfterMs;
    let nextHandoverAt = 0;    // back-off after a failed handover (e.g. merchant bag full)

    let noPotionsAt = 0;       // merchant said it can't bring potions (no gold yet)
    comms.on("coming", function (data) {
        pendingSince = 0;
        noPotionsAt = data && data.potions === false ? Date.now() : 0;
    });

    function counts() {
        const n = util.potionNames(p);
        return { hp: util.countItem(n.hp), mp: util.countItem(n.mp) };
    }

    function isHandover(item) {
        if (!item) return false;
        if (s.keep.includes(item.name)) return false;
        if (((s.keepByClass || {})[character.ctype] || []).includes(item.name)) return false;
        if (ctx.gear && ctx.gear.isReserved(item)) return false; // wished gear stays with us
        const def = G.items[item.name];
        if (def && def.type === "pot") return isOutgrownPotion(item.name);
        return true;
    }

    // A smaller potion size than the one we use now (e.g. hpot0 once we drink hpot1):
    // goes to the merchant – teammates may still use it – once we hold enough of the
    // current size. Every other potion stays with us.
    function isOutgrownPotion(name) {
        const m = /^(hpot|mpot)(\d+)$/.exec(name);
        if (!m) return false;
        const current = util.potionNames(p)[m[1] === "hpot" ? "hp" : "mp"];
        const c = /^(hpot|mpot)(\d+)$/.exec(current);
        if (!c || Number(m[2]) >= Number(c[2])) return false;
        return util.countItem(current) >= p.requestBelow;
    }

    // Gold first (needs no bag space), then items. A full merchant bag stops
    // the item part but never the gold part.
    async function handOver(name) {
        handingOver = true;
        if (is_moving(character)) stop();
        try {
            const surplus = character.gold - util.goldAmount(s.goldKeep);
            if (surplus >= s.goldMinSend) {
                await send_gold(name, surplus);
                util.log("supply", "handed " + surplus + " gold to " + name, "green");
            }
        } catch (e) {
            util.log("supply", "gold handover failed: " + util.errReason(e), "red");
        }

        let sent = 0;
        try {
            for (;;) {
                const index = util.findItemIndex(isHandover); // re-locate every time
                if (index === -1) break;
                const item = character.items[index];
                await send_item(name, index, item.q || 1);
                sent++;
            }
        } catch (e) {
            nextHandoverAt = Date.now() + 30 * 1000;
            util.log("supply", "item handover stopped after " + sent + " stacks: " + util.errReason(e), "orange");
        } finally {
            if (sent) util.log("supply", "handed " + sent + " stacks to " + name, "green");
            lastPickup = Date.now(); // even a partial handover counts as the routine visit
            handingOver = false;
        }
    }

    function needsPickup(c) {
        return c.hp < p.requestBelow || c.mp < p.requestBelow ||
            character.esize < s.freeSlotsMin ||
            Date.now() - lastPickup > s.pickupEveryMs;
    }

    function requestPickup(c) {
        lastRequest = Date.now();
        if (!pendingSince) pendingSince = lastRequest;
        comms.send(merchant, "pickup", {
            map: character.map,
            x: Math.round(character.x),
            y: Math.round(character.y),
            want: {
                [util.potionNames(p).hp]: Math.max(0, p.target - c.hp),
                [util.potionNames(p).mp]: Math.max(0, p.target - c.mp),
            },
        });
    }

    async function selfResupply() {
        busy = true;
        try {
            util.status("buying potions", "yellow");
            util.log("supply", noPotionsAt ? "merchant has no potions for us yet - buying them myself" : "no merchant answer - buying potions myself", "orange");
            await smart_move({ to: "potions" });
            const n = util.potionNames(p);
            for (const name of [n.hp, n.mp]) {
                const want = p.target - util.countItem(name);
                const affordable = Math.floor(character.gold / G.items[name].g);
                const amount = Math.min(want, affordable);
                if (amount > 0) await buy(name, amount);
            }
            pendingSince = 0;
            noPotionsAt = 0;
        } catch (e) {
            util.log("supply", "self resupply failed: " + util.errReason(e), "red");
        } finally {
            busy = false;
        }
    }

    function tick() {
        if (busy) return "busy";
        // Stand still while items go over: walking or chasing out of range cut handovers
        // short (2026-11-17). Potions still run (they come before this in the tick).
        if (handingOver) return "busy";
        const c = counts();
        const now = Date.now();

        if (merchant && !handingOver && now >= nextHandoverAt) {
            const m = get_player(merchant);
            if (m && util.isNear(m, 250)) handOver(merchant); // runs async, guarded by handingOver
        }

        if (merchant && needsPickup(c) && now - lastRequest > s.requestEveryMs) {
            requestPickup(c);
        }

        // No merchant, no answer for a while, or it told us it has no potions for us.
        const merchantSilent = !merchant || (pendingSince && now - pendingSince > s.merchantTimeoutMs) ||
            (noPotionsAt && now - noPotionsAt < 10 * 60 * 1000);
        if ((c.hp < p.selfBuyBelow || c.mp < p.selfBuyBelow) && merchantSilent) {
            selfResupply();
            return "busy";
        }
        return "ok";
    }

    // Manual trigger (chat command /pickup): call the merchant right now.
    function requestNow() {
        if (!merchant) return false;
        requestPickup(counts());
        util.log("supply", "pickup requested from " + merchant, "yellow");
        return true;
    }

    return { tick: tick, requestNow: requestNow };
};
