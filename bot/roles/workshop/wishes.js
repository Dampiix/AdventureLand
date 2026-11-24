// =====================================================================
// roles/workshop/wishes.js - the fighters' wishes and deliveries: wish list, delivered marks, earmarks, delivery, the merchant's own wishes, drop shortages.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    function loadDelivered() {
        try { return get(wks.DELIVERED_KEY) || {}; } catch (e) { return {}; }
    }
    function deliveredKey(fighter, w) {
        return fighter + ":" + w.name + ":" + (w.level || 0) + ":" + (w.stat || "");
    }
    function markDelivered(fighter, w) {
        wks.delivered[deliveredKey(fighter, w)] = Date.now();
        try { set(wks.DELIVERED_KEY, wks.delivered); } catch (e) { /* storage unavailable – only this session remembers */ }
    }
    function recentlyDelivered(fighter, w) {
        return Date.now() - (wks.delivered[deliveredKey(fighter, w)] || 0) < cfg.redeliverAfterMs;
    }

    function key(fighter, w) { return fighter + ":" + w.name + ":" + w.level; }

    // Guide wishes plus fixed wishes from config.workshop.wishes, minus recent deliveries.
    function wishList(fighter) {
        // Weapon wishes only of the types our gear plan names for the class (plus worn ones):
        // the guide wished a Ghastly Battle Axe +5 for the dual-wielding warrior and a 1M buy
        // order went up (player decision 2026-11-20: plans change through our list, not the guide).
        const used = wks.usedWeaponTypes(fighter, wks.fighterClass(fighter));
        const list = (wks.wishes[fighter] || []).filter(function (w) {
            const def = G.items[w.name];
            return !used || !def || def.type !== "weapon" || !!used[def.wtype];
        });
        ((cfg.wishes || {})[fighter] || []).forEach(function (w) {
            if (G.items[w.name] && !list.some(function (x) { return x.name === w.name && x.level >= w.level; })) list.push(w);
        });
        return list.map(function (w) { return wks.withMainStat(fighter, fromTheBack(fighter, w)); })
            // Rings and earrings come in pairs: the second copy is not held back by the
            // 6 h redelivery pause (player decision 2026-11-17).
            .filter(function (w) {
                const t = G.items[w.name] && G.items[w.name].type;
                return t === "ring" || t === "earring" || (w.count || 1) > 1 || !recentlyDelivered(fighter, w);
            });
    }
    function fromTheBack(fighter, w) {
        const mk = fighter + "|" + w.name + "|" + (w.level || 0);
        const m = wks.backMemo[mk];
        if (m && Date.now() - m.at < 2000) return m.w;
        const r = fromTheBackNow(fighter, w);
        wks.backMemo[mk] = { at: Date.now(), w: r };
        return r;
    }
    function fromTheBackNow(fighter, w) {
        const plan = config.gearPlan;
        const cls = wks.fighterClass(fighter);
        if (!plan || !plan.chainsFor || !cls || !G.classes[cls] || w.count > 1) return w;
        const chain = plan.chainsFor(cls, G.classes[cls].main_stat).find(function (e) {
            return e && e.steps && !e.carry && e.steps.some(function (st) { return st.name === w.name && (st.level || 0) === (w.level || 0); });
        });
        if (!chain) return w;
        const steps = chain.steps;
        const at = steps.findIndex(function (st) { return st.name === w.name && (st.level || 0) === (w.level || 0); });
        const now = Date.now();
        for (let j = steps.length - 1; j > at; j--) {
            const name = steps[j].name;
            if (name === w.name || !G.items[name] || !wks.unlockedCopies(name).length) continue;
            const first = steps.find(function (st, i) { return i > at && st.name === name; });
            const sub = { name: name, level: first.level || 0, full: true };
            if ((wks.blockedUntil[key(fighter, wks.withMainStat(fighter, sub))] || 0) > now) continue; // can't right now: step back
            return sub;
        }
        return w;
    }
    function saveEarmarks() {
        try { set(wks.EARMARK_KEY, wks.earmarks); } catch (e) { /* storage unavailable */ }
    }
    function activeEarmarks() {
        const now = Date.now();
        return Object.keys(wks.earmarks).filter(function (k) {
            if (now - wks.earmarks[k].at < wks.EARMARK_MS && config.characters[wks.earmarks[k].fighter]) return true;
            delete wks.earmarks[k];
            return false;
        }).map(function (k) { return wks.earmarks[k]; });
    }
    function earmark(fighter, name, level, stat) {
        const k = fighter + "|" + name;
        if (wks.earmarks[k] && wks.earmarks[k].level >= level && (wks.earmarks[k].stat || null) === (stat || null)) return;
        wks.earmarks[k] = { fighter: fighter, name: name, level: level, stat: stat || null, at: Date.now() };
        saveEarmarks();
    }

    // A bag copy that fulfils a wish/earmark: at least `level`, with the wished stat
    // (str/int/dex scroll) if one is asked for. Smallest such level first.
    // A copy whose stat another fighter wishes for is that fighter's: re-scrolling it ping-ponged
    // one pair of pants between STR (warrior) and INT (priest) at 8k a scroll (2026-11-19).
    function statReserved(stat, name, fighter) {
        if (!stat) return false;
        return wks.allFighters().some(function (f) {
            return f !== fighter && wishList(f).some(function (w) { return w.name === name && w.stat === stat; });
        });
    }
    // Restat candidate for a wish: no stat yet, or a stat nobody else wishes on this item.
    function restatOk(it, w, fighter) {
        return it.stat_type !== w.stat && !statReserved(it.stat_type, it.name, fighter);
    }

    // The copy a wish gets: the BEST that fits (player decision 2026-11-21) - weapons, chain pieces and
    // jewelry alike: a fighter wearing a +1 ring and wishing +2 gets our +3 at once instead of the +2 now and
    // the +3 on the next round (two Swords of the Dead +5/+6, a Staff of the Dead +6/+7 ...). Was: the
    // lowest that fits. The wish level only stops further upgrading once a copy reaches it.
    function wishIndex(w, level) {
        let best = -1;
        character.items.forEach(function (item, i) {
            if (!item || item.name !== w.name || (item.level || 0) < level) return;
            if (w.stat && item.stat_type !== w.stat) return;
            if (best === -1 || (item.level || 0) > (character.items[best].level || 0)) best = i;
        });
        return best;
    }

    // Items reserved for a fighter must not be sold or banked.
    // Equivalent pieces running with the armor goals (gearPlan.equivalent / gearPlan.parallel,
    // player decision 2026-11-19): a Wanderer's piece replaces the shop piece of its slot at
    // the same level and is then upgraded instead of it; without a spare copy the shop piece
    // is built higher and takes the slot back. Tanks (Rugged) are not part of it.
    function equivMap() { return (config.gearPlan && config.gearPlan.equivalent) || {}; }
    // Every ingredient of a recipe in stock (bag + bank) - crafting from what we hold, never a
    // reason to send the team farming (gearPlan.craftFromStock, player decision 2026-11-19).
    function craftableFromStock(name) {
        const r = G.craft[name];
        if (!r || !((config.gearPlan || {}).craftFromStock || []).includes(name)) return false;
        return r.items.every(function (it) { return wks.ingredientCount(it[1], 0) >= it[0]; });
    }
    function parallelFor(f) {
        const plan = config.gearPlan || {};
        const g = plan.parallel && plan.groups && plan.groups[plan.parallel];
        const cls = wks.fighterClass(f);
        return !!(g && cls && g.includes(cls));
    }
    // A copy of an equivalent piece is kept while some such fighter can still use it: it wears
    // the shop piece of that slot, or the same piece below the last armor stage (or lower than
    // this copy). Otherwise it is sold like any drop (2026-11-19: no spare copies kept).
    function equivalentWanted(item) {
        const shop = equivMap()[item.name];
        if (!shop || !G.items[item.name]) return false;
        const slots = wks.SLOTS_BY_TYPE[G.items[item.name].type] || [];
        return config.team.fighters.some(function (f) {
            if (!parallelFor(f)) return false;
            const eq = wks.worn[f];
            if (!eq) return true; // unknown yet
            return slots.some(function (s) {
                const w = eq[s];
                if (!w || w.name === shop) return true;
                if (w.name === item.name) return (w.level || 0) < wks.finalStage() || (item.level || 0) > (w.level || 0);
                return false;
            });
        });
    }
    function isReserved(item) {
        if (equivalentWanted(item)) return true;
        if (activeEarmarks().some(function (e) { return e.name === item.name && (item.level || 0) >= e.level; })) return true;
        return wks.allFighters().some(function (f) {
            return wishList(f).some(function (w) { return w.name === item.name; });
        });
    }

    // ---- delivery -------------------------------------------------------

    // A copy of name at level or higher in the bag or the bank.
    function copyAtLeast(name, level) {
        if (character.items.some(function (it) { return it && it.name === name && (it.level || 0) >= level; })) return true;
        return !!(wks.bankSnapshot && wks.bankSnapshot.items.some(function (b) { return b.name === name && b.level >= level; }));
    }

    // Wishes we can fulfil from the bag now, plus earmarked items waiting in the bag.
    function readyFor(fighter) {
        const list = wishList(fighter).filter(function (w) { return wishIndex(w, wks.targetLevel(fighter, w)) !== -1; });
        activeEarmarks().forEach(function (e) {
            if (e.fighter !== fighter || list.some(function (w) { return w.name === e.name; })) return;
            if (wishIndex(e, e.level) !== -1) list.push({ name: e.name, level: e.level, stat: e.stat || null });
        });
        return list;
    }

    // An item with a stat slot that still lacks the fighter's main stat stays here until statBeforeDelivery put it on.
    function lacksMainStat(fighter, item) {
        if ((cfg.statOnDelivery || {}).enabled === false) return false;
        const def = item && G.items[item.name];
        const main = wks.classes[fighter] && G.classes[wks.classes[fighter]] && G.classes[wks.classes[fighter]].main_stat;
        return !!(def && def.stat && main && item.stat_type !== main);
    }
    async function handOver(fighter) {
        for (const w of readyFor(fighter)) {
            const index = wishIndex(w, wks.targetLevel(fighter, w));
            if (index === -1) continue;
            const item = character.items[index];
            if (lacksMainStat(fighter, item)) continue;
            await send_item(fighter, index, 1);
            util.log("workshop", "delivered " + item.name + " +" + (item.level || 0) + " to " + fighter, "green");
            markDelivered(fighter, w);
            if (G.items[item.name]) wks.filledAt[fighter + "|" + G.items[item.name].type] = Date.now();
            if (wks.earmarks[fighter + "|" + w.name]) delete wks.earmarks[fighter + "|" + w.name];
            else delete wks.earmarks[fighter + "|" + w.name + "|2"]; // the second copy of a weapon pair
            saveEarmarks();
            wks.wishes[fighter] = (wks.wishes[fighter] || []).filter(function (x) { return x !== w; });
        }
        // Finished gear-goal copies (indexes stay valid: sending only empties a slot).
        for (const a of wks.goalReadyFor(fighter)) {
            const item = character.items[a.index];
            if (!item || item.name !== a.need.name || lacksMainStat(fighter, item)) continue;
            await send_item(fighter, a.index, 1);
            wks.goalSentAt[fighter + ":" + a.need.slot] = Date.now();
            util.log("workshop", "delivered " + item.name + " +" + (item.level || 0) + " to " + fighter + " (gear goal)", "green");
        }
    }
    function saveShortages() {
        try { set(wks.SHORT_KEY, wks.shortages); } catch (e) { /* storage unavailable */ }
    }

    // ---- the merchant's own wishes (config.merchantRole.ownWishes) --------------------
    function ownHas(name) {
        if (Object.values(character.slots || {}).some(function (s) { return s && s.name === name; })) return true;
        if (character.items.some(function (i) { return i && i.name === name; })) return true;
        return !!(wks.bankSnapshot && wks.bankSnapshot.items.some(function (b) { return b.name === name; }));
    }
    function isOwnWish(name) {
        return (config.merchantRole.ownWishes || []).some(function (w) { return w.name === name; });
    }
    // One missing own wish per round: bought, crafted, or its missing drop ingredient is
    // reported as a shortage (the drop system sends a fighter for it). Returns true if done.
    async function workOwnWishes() {
        const now = Date.now();
        for (const w of config.merchantRole.ownWishes || []) {
            const def = G.items[w.name];
            if (!def || ownHas(w.name)) continue;
            const k = "_own:" + w.name;
            if (wks.blockedUntil[k] > now) continue;
            if (character.esize < 2) return false;
            try {
                const seller = wks.sellerOf(w.name);
                if (seller) {
                    if (!wks.canSpend(k, def.g)) throw { reason: "budget" };
                    util.status("buy " + w.name, "orange");
                    await wks.goTo(seller);
                    await buy(w.name, 1);
                    wks.pay(k, def.g);
                    util.log("workshop", "bought my own " + def.name + " for " + def.g, "green");
                    return true;
                }
                if (wks.crafterOf(w.name)) {
                    util.status("craft " + w.name, "orange");
                    const r = await wks.craftItem(k, w.name);
                    if (r.ok) return true;
                    util.log("workshop", "can't craft my " + def.name + " yet - missing " +
                        r.missing.map(function (m) { return (m.need - m.have) + "x " + m.name; }).join(", "), "orange");
                    r.missing.forEach(function (m) { noteIngredientShortage(m.name, m.level, m.need, w.name); });
                } else {
                    noteShortage(w.name, 0);
                }
                wks.blockedUntil[k] = now + cfg.giveUpForMs;
            } catch (e) {
                util.log("workshop", "my " + w.name + ": " + util.errReason(e), "orange");
                wks.blockedUntil[k] = now + wks.pauseAfter(k, util.errReason(e));
            }
        }
        return false;
    }

    function noteShortage(name, level) {
        wks.shortages[name] = { level: level, at: Date.now() };
        saveShortages();
    }

    // A craft ingredient we lack: `need` in total, for the wished item `forItem`.
    function noteIngredientShortage(name, level, need, forItem) {
        wks.shortages[name] = { level: level, at: Date.now(), need: need, forItem: forItem };
        saveShortages();
    }

    Object.assign(wks, {
        loadDelivered: loadDelivered,
        deliveredKey: deliveredKey,
        markDelivered: markDelivered,
        recentlyDelivered: recentlyDelivered,
        key: key,
        wishList: wishList,
        fromTheBack: fromTheBack,
        fromTheBackNow: fromTheBackNow,
        saveEarmarks: saveEarmarks,
        activeEarmarks: activeEarmarks,
        earmark: earmark,
        statReserved: statReserved,
        restatOk: restatOk,
        wishIndex: wishIndex,
        equivMap: equivMap,
        craftableFromStock: craftableFromStock,
        parallelFor: parallelFor,
        equivalentWanted: equivalentWanted,
        isReserved: isReserved,
        copyAtLeast: copyAtLeast,
        readyFor: readyFor,
        lacksMainStat: lacksMainStat,
        handOver: handOver,
        saveShortages: saveShortages,
        ownHas: ownHas,
        isOwnWish: isOwnWish,
        workOwnWishes: workOwnWishes,
        noteShortage: noteShortage,
        noteIngredientShortage: noteIngredientShortage,
    });
};
