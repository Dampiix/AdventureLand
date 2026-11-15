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
    let lastPickup = Date.now();
    let nextHandoverAt = 0;    // back-off after a failed handover (e.g. merchant bag full)

    comms.on("coming", function () { pendingSince = 0; });

    function counts() {
        return { hp: util.countItem(p.hp), mp: util.countItem(p.mp) };
    }

    function isHandover(item) {
        if (!item) return false;
        if (s.keep.includes(item.name)) return false;
        if (item.name === p.hp || item.name === p.mp) return false;
        const def = G.items[item.name];
        if (def && def.type === "pot") return false; // keep every potion size
        return true;
    }

    async function handOver(name) {
        handingOver = true;
        try {
            let sent = 0;
            for (;;) {
                const index = util.findItemIndex(isHandover); // re-locate every time
                if (index === -1) break;
                const item = character.items[index];
                await send_item(name, index, item.q || 1);
                sent++;
            }
            const surplus = character.gold - s.goldKeep;
            if (surplus >= s.goldMinSend) await send_gold(name, surplus);
            if (sent || surplus >= s.goldMinSend) {
                util.log("supply", "handed " + sent + " stacks" + (surplus >= s.goldMinSend ? " + " + surplus + " gold" : "") + " to " + name, "green");
            }
            lastPickup = Date.now();
        } catch (e) {
            nextHandoverAt = Date.now() + 30 * 1000;
            util.log("supply", "handover failed: " + util.errReason(e), "red");
        } finally {
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
            x: Math.round(character.real_x),
            y: Math.round(character.real_y),
            want: {
                [p.hp]: Math.max(0, p.target - c.hp),
                [p.mp]: Math.max(0, p.target - c.mp),
            },
        });
    }

    async function selfResupply() {
        busy = true;
        try {
            util.status("buying potions", "yellow");
            util.log("supply", "no merchant answer - buying potions myself", "orange");
            await smart_move({ to: "potions" });
            for (const name of [p.hp, p.mp]) {
                const want = p.target - util.countItem(name);
                const affordable = Math.floor(character.gold / G.items[name].g);
                const amount = Math.min(want, affordable);
                if (amount > 0) await buy(name, amount);
            }
            pendingSince = 0;
        } catch (e) {
            util.log("supply", "self resupply failed: " + util.errReason(e), "red");
        } finally {
            busy = false;
        }
    }

    function tick() {
        if (busy) return "busy";
        const c = counts();
        const now = Date.now();

        if (merchant && !handingOver && now >= nextHandoverAt) {
            const m = get_player(merchant);
            if (m && util.isNear(m, 250)) handOver(merchant); // runs async, guarded by handingOver
        }

        if (merchant && needsPickup(c) && now - lastRequest > s.requestEveryMs) {
            requestPickup(c);
        }

        const merchantSilent = !merchant || (pendingSince && now - pendingSince > s.merchantTimeoutMs);
        if ((c.hp < p.selfBuyBelow || c.mp < p.selfBuyBelow) && merchantSilent) {
            selfResupply();
            return "busy";
        }
        return "ok";
    }

    return { tick: tick };
};
