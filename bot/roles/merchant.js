// =====================================================================
// bot_merchant – the merchant supports the fighters.
//
// Idle (in town near the potion shop):
//   - sell items from config.merchantRole.sellList (shiny and locked
//     items never; upgraded ones only up to the entry's maxLevel)
//   - bag running full -> store everything else in the bank
//     (config.merchantRole.bank), never buying new bank packs
//   - keep a potion stock (config.merchantRole.stock), never spending
//     below goldReserve (a share of our gold, so a fresh merchant still works)
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
        Object.keys(data.want || {}).forEach(function (name) {
            if (!G.items[name] || G.items[name].type !== "pot") return;
            stocked.set(name, Date.now());
            if (!users.has(name)) users.set(name, new Map());
            users.get(name).set(from, Date.now());
        });
        if (isNew) util.log("merchant", "pickup requested by " + from, "yellow");
        // Tell the fighter whether we can bring its potions; if not, it buys them itself.
        comms.send(from, "coming", { potions: canSupply(data.want) });
    });

    // At least half of every wanted potion type: in the bag or affordable above the reserve.
    function canSupply(want) {
        const spendable = Math.max(0, character.gold - util.goldAmount(m.goldReserve));
        return Object.keys(want || {}).every(function (name) {
            const need = want[name] || 0;
            if (need <= 0 || !G.items[name]) return true;
            return util.countItem(name) + Math.floor(spendable / G.items[name].g) >= need / 2;
        });
    }

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

    // Items any NPC shop sells (can be bought back at any time).
    const npcSold = new Set();
    Object.keys(G.npcs).forEach(function (id) {
        (Array.isArray(G.npcs[id].items) ? G.npcs[id].items : []).forEach(function (name) { if (name) npcSold.add(name); });
    });

    // config.merchantRole.sellBuyable: don't store what a shop sells anyway.
    function isBuyableJunk(item) {
        const rule = m.sellBuyable;
        if (!rule || !rule.enabled || !npcSold.has(item.name)) return false;
        const def = G.items[item.name];
        if (!def || rule.exceptTypes.includes(def.type) || m.bank.keep.includes(item.name)) return false;
        return (item.level || 0) <= rule.maxLevel;
    }

    function isSellable(item) {
        if (item.p || item.l) return false;            // shiny / locked never
        if (workshop.isReserved(item)) return false;    // a fighter wishes for it
        if (workshop.isOrphanStatCopy(item)) return true;   // shop armor in a stat no fighter still builds
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

    // Potion types fighters asked for – we keep stockPerPotion of each.
    const stocked = new Map(); // potion -> last time a fighter asked for it
    const users = new Map();   // potion -> Map(fighter -> last ask)
    const poorLogged = {}; // potion -> last "not enough gold" log
    const startedAt = Date.now();

    // Fighters ask for their current potion sizes with every pickup (at least every
    // 15 min). A size nobody asked for within an hour is outgrown: no restocking,
    // and our leftovers of it are sold.
    function isWantedPotion(name) {
        return stocked.has(name) && Date.now() - stocked.get(name) < 60 * 60 * 1000;
    }
    function isOutgrownPotion(item) {
        return /^(hpot|mpot)\d+$/.test(item.name) && Date.now() - startedAt > 60 * 60 * 1000 && !isWantedPotion(item.name);
    }

    // Fighters that asked for this potion size within the last hour.
    function userCount(name) {
        const u = users.get(name);
        if (!u) return 0;
        let n = 0;
        u.forEach(function (at) { if (Date.now() - at < 60 * 60 * 1000) n++; });
        return n;
    }

    // With `wanted` (a delivery): buy what this delivery needs. Without (chores):
    // build a stock of potions.target per fighter using the size (max stockPerPotion) –
    // but only while we have stockFromGold, so equipment wishes get the gold first.
    async function restock(wanted) {
        Object.keys(wanted || {}).forEach(function (name) { if (G.items[name] && G.items[name].type === "pot") stocked.set(name, Date.now()); });
        if (!wanted && character.gold < (m.stockFromGold || 0)) return;
        for (const name of stocked.keys()) {
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
                if (Date.now() - (poorLogged[name] || 0) > 10 * 60 * 1000) {
                    poorLogged[name] = Date.now();
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

    // Skill ingredients (config.merchantRole.classItems) for this fighter's class.
    async function giveClassItems(name) {
        const ctype = workshop.classOf ? workshop.classOf(name) : null;
        for (const itemName of (ctype && m.classItems && m.classItems[ctype]) || []) {
            for (;;) {
                const index = util.findItemIndex(function (i) { return i.name === itemName; });
                if (index === -1) break;
                const q = character.items[index].q || 1;
                await send_item(name, index, q);
                util.log("merchant", "gave " + q + "x " + itemName + " to " + name, "green");
            }
        }
    }

    // One-per-character items (config.merchantRole.onePerCharacter) the fighter lacks.
    async function giveOneEach(name) {
        for (const itemName of workshop.oneEachFor ? workshop.oneEachFor(name) : []) {
            const index = util.findItemIndex(function (i) { return i.name === itemName; });
            if (index === -1) continue;
            await send_item(name, index, 1);
            workshop.markCarried(name, itemName);
            util.log("merchant", "gave a " + G.items[itemName].name + " to " + name, "green");
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
            await giveClassItems(name);
            await giveOneEach(name);
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
        if (!item || isSellable(item) || workshop.isReserved(item) || workshop.isGoalFinished(item)) return false;
        if (G.items[item.name] && G.items[item.name].type === "pot") return false; // potion stock stays with us
        if (m.bank.keep.includes(item.name)) return false;
        const gifts = [].concat.apply([], Object.values(m.give || {}));
        return !gifts.includes(item.name);
    }

    // Walk into the bank and store what we can. Returns the number of stacks stored.
    async function bankTrip() {
        util.status("banking", "yellow");
        await smart_move("bank");
        // smart_move can end outside the bank (interrupted by another move, e.g. a pickup
        // call): then every store fails with not_in_bank – try again on the next round.
        if (!character.bank) {
            util.log("merchant", "not inside the bank after the walk - banking later", "white");
            return 0;
        }
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
                const why = util.errReason(e);
                if (why === "bank_full") full = true; // stackable items may still fit – keep going
                else if (why === "not_in_bank") break; // left the bank meanwhile: next round
                else util.log("merchant", "could not bank " + item.name + ": " + why, "orange");
            }
        }
        util.log("merchant", "banked " + stored + " stacks" + (full ? " - bank is full, a new pack is needed" : ""), full ? "orange" : "green");
        await takeSellablesFromBank();
        return stored;
    }

    // Junk that ended up in the bank earlier (before it was on the sell list) is
    // taken out again and sold on the next chores round – frees bank slots.
    async function takeSellablesFromBank() {
        let taken = 0;
        for (const pack of Object.keys(character.bank || {})) {
            if (!/^items\d+$/.test(pack)) continue;
            const items = character.bank[pack] || [];
            for (let i = 0; i < items.length; i++) {
                if (character.esize <= 2) break; // leave room for loot handovers
                if (!items[i] || !isSellable(items[i])) continue;
                try {
                    await bank_retrieve(pack, i);
                    taken++;
                } catch (e) {
                    util.log("merchant", "could not take " + items[i].name + " from the bank: " + util.errReason(e), "orange");
                }
            }
        }
        if (taken) util.log("merchant", "took " + taken + " junk stacks out of the bank to sell", "green");
        return taken;
    }

    let nextBankTripAt = 0;
    let lastBankVisit = 0;
    async function bankIfNeeded() {
        if (Date.now() < nextBankTripAt) return;
        // Visit when the bag is running full, or every 30 min to clear junk out of the bank.
        const due = character.esize < m.bank.whenFreeBelow || Date.now() - lastBankVisit > 30 * 60 * 1000;
        if (!due) return;
        lastBankVisit = Date.now();
        const stored = await bankTrip();
        // Nothing fit: don't run back and forth – try again in 10 minutes.
        nextBankTripAt = Date.now() + (stored ? 60 * 1000 : 10 * 60 * 1000);
    }

    async function work() {
        if (busy) return;
        busy = true;
        try {
            // A (nearly) full bag first sheds its junk in town: otherwise a pickup can't take
            // the loot (send_no_space) and the bag never empties (2026-11-17).
            if (character.esize < 4) {
                await goHome();
                await sellJunk();
            }
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
