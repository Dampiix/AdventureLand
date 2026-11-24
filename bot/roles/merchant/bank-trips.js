// =====================================================================
// roles/merchant/bank-trips.js - bank trips: storing, taking sellables out, banking before a pickup.
// Part of bot_merchant (module plan, stage 6b): moved verbatim from the old single-file roles/merchant.js. The parts
// share one internal state (mer: pickup requests, busy, trips, the stand, timers) and call each other through mer;
// outside dependencies come in deps (config, util, comms, workshop, scout).
// =====================================================================

module.exports = function install(mer, deps) {
    const config = deps.config;
    const util = deps.util;
    const m = config.merchantRole;
    const workshop = deps.workshop;

    // Everything that is neither sold, kept, part of the potion stock nor a gift.
    // tight: the bag runs full - then reserved wish material (accessory and Wanderer copies) goes
    // to the bank as well, except what is about to be delivered (keep: bag indexes). The workshop
    // takes copies out of the bank again when it compounds or upgrades (2026-11-20: 42/42 slots,
    // pickups failed with "no space" while the bank had 52 free).
    function isBankable(item, index, tight, keep) {
        if (!item || mer.isSellable(item) || workshop.isGoalFinished(item)) return false;
        if (workshop.isReserved(item) && !(tight && tight() && !(keep && keep.has(index)))) return false;
        if (G.items[item.name] && G.items[item.name].type === "pot") return false; // potion stock stays with us
        if (mer.teamElixirs().includes(item.name)) return false; // the team's elixirs stay with us for the pickups (v1.229.0)
        if (m.bank.keep.includes(item.name)) return false;
        if (mer.marketSurplus(item.name, item.level) > 0) return false; // waits for a slot in the stand
        if (workshop.waitsForDismantle(item)) return false;           // goes to Leo, not the bank
        const gifts = [].concat.apply([], Object.values(m.give || {}));
        return !gifts.includes(item.name);
    }

    // Walk into the bank and store what we can. Returns the number of stacks stored.
    // storeOnly: only store (mid Ponty round) - no junk or stand items taken out into the bag.
    // tightBelow: reserved workshop copies go to the bank too while fewer slots than this are free
    // (default whenFreeBelow + 5).
    async function bankTrip(storeOnly, tightBelow) {
        util.status("banking", "yellow");
        // smart_move can end outside the bank (interrupted by another move, e.g. a pickup
        // call): then every store fails with not_in_bank – try again on the next round.
        // (character.bank is {} outside, so walkToBank checks for loaded packs.)
        if (!(await util.walkToBank())) {
            util.log("merchant", "not inside the bank after the walk - banking later", "white");
            return 0;
        }
        let stored = 0;
        let full = false;
        // Walk the bag once from the end; each index is checked right before storing.
        // Reserved items only while fewer than whenFreeBelow + 5 slots are free (no back and forth).
        const keep = workshop.deliveryIndexes ? workshop.deliveryIndexes() : new Set();
        const tight = function () { return character.esize < (tightBelow || (m.bank.whenFreeBelow || 6) + 5); };
        for (let index = character.items.length - 1; index >= 0; index--) {
            const item = character.items[index];
            if (!isBankable(item, index, tight, keep)) continue;
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
        // The team's elixirs come out of the bank into the bag (v1.229.0): exchange rewards and older stock land there.
        let elixirsTaken = 0;
        for (const pack of Object.keys(character.bank || {})) {
            if (!/^items\d+$/.test(pack)) continue;
            const items = character.bank[pack] || [];
            for (let i = 0; i < items.length; i++) {
                if (!items[i] || !mer.teamElixirs().includes(items[i].name)) continue;
                if (character.esize <= 3 && util.findItemIndex(function (b) { return b.name === items[i].name; }) === -1) break;
                try { await bank_retrieve(pack, i); elixirsTaken++; } catch (e) { util.log("merchant", "could not take " + items[i].name + " from the bank: " + util.errReason(e), "orange"); }
            }
        }
        if (elixirsTaken) util.log("merchant", "took " + elixirsTaken + " elixir stacks out of the bank for the team", "green");
        if ((stored || elixirsTaken) && workshop.refreshBank) workshop.refreshBank(); // the workshop counts the bank from its snapshot
        if (!storeOnly) await takeSellablesFromBank();
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
                if (!items[i] || !mer.isSellable(items[i])) continue;
                try {
                    await bank_retrieve(pack, i);
                    taken++;
                } catch (e) {
                    util.log("merchant", "could not take " + items[i].name + " from the bank: " + util.errReason(e), "orange");
                }
            }
        }
        if (taken) util.log("merchant", "took " + taken + " junk stacks out of the bank to sell", "green");
        // Market sell items (config.market.sell) above "keep": into the bag for the stand. Only the surplus
        // (2026-11-22 review): a retrieve only moves a stack from bank to bag, so the owned count never drops -
        // the kept copies came out too and went back on the next bank trip. Counted down here instead.
        const left = {};
        for (const pack of Object.keys(character.bank || {})) {
            if (!/^items\d+$/.test(pack)) continue;
            const items = character.bank[pack] || [];
            for (let i = 0; i < items.length; i++) {
                if (character.esize <= 3) break;
                if (!items[i]) continue;
                const k = items[i].name + ":" + (items[i].level || 0);
                if (!(k in left)) left[k] = mer.marketSurplus(items[i].name, items[i].level) - mer.bagCount(items[i].name, items[i].level || 0);
                if (left[k] <= 0) continue;
                left[k] -= items[i].q || 1;
                try {
                    await bank_retrieve(pack, i);
                    util.log("merchant", "took " + items[i].name + " from the bank for the stand", "green");
                } catch (e) { /* next time */ }
                if (workshop.refreshBank) workshop.refreshBank(); // the next surplus check must not count it twice
            }
        }
        return taken;
    }
    async function bankBeforePickup() {
        const want = m.bank.beforePickupFree || 0;
        if (!want || character.esize >= want || Date.now() < mer.nextPrePickupBankAt) return;
        const stored = await bankTrip(true, want);
        mer.lastBankVisit = Date.now();
        if (!stored) mer.nextPrePickupBankAt = Date.now() + 10 * 60 * 1000;
    }
    async function bankIfNeeded() {
        if (Date.now() < mer.nextBankTripAt) return;
        // Visit when the bag is running full, or every 30 min to clear junk out of the bank.
        // Idle workshop stock (2026-11-23, player decision): below bank.stockFreeBelow free slots the jewellery and
        // other copies waiting for their compound/upgrade go to the bank too - the workshop takes them out again when
        // it works on them (retrieve). The bag was full of rings, amulets and belts while the bank had 49 free slots.
        const stockFree = m.bank.stockFreeBelow || 0;
        const due = character.esize < m.bank.whenFreeBelow || character.esize < stockFree || Date.now() - mer.lastBankVisit > 30 * 60 * 1000;
        if (!due) return;
        mer.lastBankVisit = Date.now();
        const stored = await bankTrip(false, stockFree || undefined);
        // Nothing fit: don't run back and forth – try again in 10 minutes.
        mer.nextBankTripAt = Date.now() + (stored ? 60 * 1000 : 10 * 60 * 1000);
    }

    Object.assign(mer, {
        isBankable: isBankable,
        bankTrip: bankTrip,
        takeSellablesFromBank: takeSellablesFromBank,
        bankBeforePickup: bankBeforePickup,
        bankIfNeeded: bankIfNeeded,
    });
};
