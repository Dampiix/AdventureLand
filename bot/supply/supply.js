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

// deps (module plan, stage 7a): { config, util, comms, gear, cave } - read when used.
module.exports = function createSupply(deps) {
    const config = deps.config;
    const util = deps.util;
    const comms = deps.comms;
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
    // While the merchant is on its way we keep farming and tell it where we are, so it
    // follows us instead of walking to where we called from (player decision 2026-11-17:
    // the Phoenix hunter was long gone and the merchant walked back to town every time).
    let followUntil = 0;       // send our position until then (or until the merchant is done)
    let lastPosAt = 0;
    // The merchant was here: the routine timer restarts even when we had nothing to hand
    // over (it otherwise kept calling every minute after an empty visit).
    comms.on("served", function () { followUntil = 0; lastPickup = Date.now(); });
    function sendPosition() {
        lastPosAt = Date.now();
        comms.send(merchant, "pos", { map: character.map, x: Math.round(character.x), y: Math.round(character.y) });
    }

    function counts() {
        const n = util.potionNames(p);
        return { hp: util.countItem(n.hp), mp: util.countItem(n.mp) };
    }

    // ---- elixirs (v1.229.0, config.elixirs) --------------------------------------------------------------------------
    // Our class's elixir: carried (never handed over), asked for with every pickup up to `carry`, and drunk when none
    // works or ours runs out within drinkBeforeMs (the same one again extends it). Another elixir that works is left alone.
    const el = config.elixirs || {};
    function ownElixir() {
        const it = el.enabled ? (el.byClass || {})[character.ctype] : null;
        return it && G.items[it] ? it : null;
    }
    let elixirTryAt = 0;
    function drinkElixir() {
        const it = ownElixir();
        if (!it || character.rip || Date.now() < elixirTryAt) return;
        const cur = character.slots && character.slots.elixir;
        const left = cur && cur.expires ? new Date(cur.expires).getTime() - Date.now() : 0;
        if (cur && left > 0 && (cur.name !== it || left > (el.drinkBeforeMs || 10 * 60 * 1000))) return;
        const index = util.findItemIndex(function (i) { return i.name === it && !i.l; });
        if (index === -1) return;
        elixirTryAt = Date.now() + 30 * 1000;
        Promise.resolve(equip(index))
            .then(function () { util.log("supply", "drank " + G.items[it].name + (cur && left > 0 ? " (extends the running one)" : ""), "green"); })
            .catch(function (e) { util.log("supply", "could not drink " + G.items[it].name + ": " + util.errReason(e), "orange"); });
    }

    function isHandover(item) {
        if (!item) return false;
        if (s.keep.includes(item.name)) return false;
        if (item.name === ownElixir()) return false; // our elixir stays with us
        if (((s.keepByClass || {})[character.ctype] || []).includes(item.name)) return false;
        if (deps.gear && deps.gear.isReserved(item)) return false; // wished gear stays with us
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
    // Only stop for a handover when there is something to give: passing the merchant in
    // town with nothing to hand over stopped every route again (2026-11-17).
    function somethingToHandOver() {
        return character.gold - util.goldAmount(s.goldKeep) >= s.goldMinSend || util.findItemIndex(isHandover) !== -1;
    }
    async function handOver(name) {
        handingOver = true;
        if (is_moving(character)) stop();
        try {
            const surplus = character.gold - util.goldAmount(s.goldKeep);
            if (surplus >= s.goldMinSend) {
                await send_gold(name, surplus);
                util.log("supply", "handed " + surplus + " gold to " + name, "green");
                // The merchant counts handed-over gold as income, even in one big jump
                // (8.6M from selling to a player's buy orders, 2026-11-17).
                comms.send(name, "gold", { a: surplus });
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
            nextHandoverAt = Math.max(nextHandoverAt, Date.now() + 15 * 1000); // no stop-and-go while passing by
            handingOver = false;
        }
    }

    // Short on our elixir (v1.229.3, player report 2026-11-24: the priest had none and the warrior one spare, and both
    // waited for the 20-min routine): fewer than half of `carry` in the bag calls the merchant - at most every
    // elixirs.callEveryMs after its last visit, so a merchant without elixirs is not called every minute.
    function elixirShort() {
        const it = ownElixir();
        return !!it && util.countItem(it) < Math.ceil((el.carry || 4) / 2) && Date.now() - lastPickup > (el.callEveryMs || 5 * 60 * 1000);
    }
    function needsPickup(c) {
        return c.hp < p.requestBelow || c.mp < p.requestBelow ||
            character.esize < s.freeSlotsMin ||
            elixirShort() ||
            Date.now() - lastPickup > s.pickupEveryMs;
    }

    function requestPickup(c) {
        lastRequest = Date.now();
        followUntil = lastRequest + (s.followMs || 5 * 60 * 1000);
        if (!pendingSince) pendingSince = lastRequest;
        const want = {
            [util.potionNames(p).hp]: Math.max(0, p.target - c.hp),
            [util.potionNames(p).mp]: Math.max(0, p.target - c.mp),
        };
        const elixir = ownElixir();
        if (elixir) want[elixir] = Math.max(0, (el.carry || 4) - util.countItem(elixir));
        comms.send(merchant, "pickup", {
            map: character.map,
            x: Math.round(character.x),
            y: Math.round(character.y),
            want: want,
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
        drinkElixir();
        if (busy) return "busy";
        // Stand still while items go over: walking or chasing out of range cut handovers
        // short (2026-11-17). Potions still run (they come before this in the tick).
        if (handingOver) return "busy";
        const c = counts();
        const now = Date.now();

        if (merchant && !handingOver && now >= nextHandoverAt && somethingToHandOver()) {
            const m = get_player(merchant);
            if (m && util.isNear(m, 250)) handOver(merchant); // runs async, guarded by handingOver
        }

        if (merchant && needsPickup(c) && now - lastRequest > s.requestEveryMs) {
            requestPickup(c);
        } else if (merchant && followUntil > now && now - lastPosAt >= (s.positionEveryMs || 5000)) {
            sendPosition();
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

    // The merchant calls us before it leaves for a Ponty round on other servers (player
    // decision 2026-11-20): we ask for a pickup at once, so everyone is stocked and emptied.
    comms.on("callpickup", function (data, from) {
        if (!merchant || from !== merchant) return;
        if (deps.cave && deps.cave.inCave()) return; // the merchant can't come into the cave (v1.231.0)
        requestPickup(counts());
        util.log("supply", "merchant calls before its Ponty round - pickup requested", "yellow");
    });

    // Manual trigger (chat command /pickup): call the merchant right now.
    function requestNow() {
        if (!merchant) return false;
        requestPickup(counts());
        util.log("supply", "pickup requested from " + merchant, "yellow");
        return true;
    }

    return { tick: tick, requestNow: requestNow };
};
