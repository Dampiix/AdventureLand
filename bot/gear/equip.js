// =====================================================================
// gear/equip.js - equipping upgrades from the bag (the guide's equip rows, main stat, min / max levels, blocked slots).
// Part of bot_gear (module plan, stage 7a): moved verbatim from the old single-file core/gear.js. The parts share
// one internal state (gr: wishes, the luck swap, held weapons, timers) and call each other through gr; outside
// dependencies come in deps (config, util, comms, WEARABLE).
// =====================================================================

module.exports = function install(gr, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.gear;
    const WEARABLE = deps.WEARABLE;

    function bagKey() {
        return character.items.map(function (i) { return i ? i.name + ":" + (i.level || 0) : "-"; }).join("|");
    }

    // Follow the guide's "equip" rows after the bag changed. The guide only suggests
    // owned items that add attack or 10+ armor, so a +0 piece for an EMPTY slot
    // (gloves, amulet, ...) is never equipped by it – we do that ourselves: anything
    // usable beats an empty slot.
    // A wrong scroll stat (player rule 2026-11-18): a piece with a stat slot (shop armor,
    // Rugged ...) carrying another main stat than ours counts as weaker than the same kind of
    // piece with our stat up to one level lower - helmet +7 DEX beats helmet +8 STR for a rogue.
    // Built-in stats (Dagger of the Dead +20 STR) and pieces without a stat slot are not affected.
    function wrongStat(it) {
        const def = it && G.items[it.name];
        const own = G.classes[character.ctype] && G.classes[character.ctype].main_stat;
        return !!(def && def.stat && it.stat_type && ["str", "int", "dex"].includes(it.stat_type) && it.stat_type !== own);
    }
    function ownStat(it) {
        const own = G.classes[character.ctype] && G.classes[character.ctype].main_stat;
        return !!(it && it.stat_type && it.stat_type === own);
    }
    async function equipPass(weaponsLocked) {
        const slotOk = function (s) { return !(weaponsLocked && (s === "mainhand" || s === "offhand")); };
        gr.equipping = true;
        const wornBefore = JSON.stringify(gr.worn());
        try {
            const rows = (gr.guide().rows || []).filter(function (r) { return r.action && r.action.kind === "equip"; });
            for (const row of rows) {
                const a = row.action;
                const item = character.items[a.num];
                if (!item || item.name !== a.name || (item.level || 0) !== (a.level || 0)) continue; // bag changed meanwhile
                if (!slotOk(a.slot)) continue;
                if (gr.isCarry(item.name)) continue; // carried for a later mode, not worn
                if (gr.NO_EQUIP.has(G.items[item.name])) continue;
                if (equipBlocked(item, a.slot)) continue; // min level, max worn, luck-swap piece (2026-11-22)
                if (gr.chainDowngrade(item, a.slot)) continue;
                const there = character.slots && character.slots[a.slot];
                if (wrongStat(item) && ownStat(there) && (there.level || 0) >= (item.level || 0) - 1) continue; // our stat wins
                await equip(a.num, a.slot);
                util.log("gear", "equipped " + a.name + " +" + (a.level || 0) + " -> " + a.slot, "green");
                return; // the bag changed – re-read the guide next time
            }
            // A better copy of a piece we wear (higher level without losing the stat, or
            // the same level with a stat the worn one lacks): the guide skips small gains.
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                const def = item && G.items[item.name];
                if (!def || !WEARABLE.includes(def.type) || !gr.usable(def)) continue;
                const slot = gr.slotsFor(def).find(function (s) {
                    if (!slotOk(s)) return false;
                    if (equipBlocked(item, s)) return false;
                    const w = character.slots && character.slots[s];
                    if (w && gr.equivalentOf(item, w)) return true;
                    if (!w || w.name !== item.name) return false;
                    const lvl = item.level || 0, wl = w.level || 0;
                    if (wrongStat(w) && ownStat(item)) return lvl >= wl - 1; // our stat over a wrong one
                    if (wrongStat(item)) return false;
                    if (w.stat_type && item.stat_type !== w.stat_type) return false;
                    return lvl > wl || (lvl === wl && !!item.stat_type && !w.stat_type);
                });
                if (!slot) continue;
                await equip(num, slot);
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + (item.stat_type ? " " + item.stat_type : "") + " -> " + slot + " (better copy)", "green");
                return;
            }
            // A piece further along a class wish chain (e.g. Orb of Strength +1 over
            // Orb of Beginnings +2): the guide doesn't know our chains.
            const up = gr.chainUpgrade(slotOk);
            if (up) {
                const item = character.items[up.num];
                await equip(up.num, up.slot);
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> " + up.slot + " (next class wish step)", "green");
                return;
            }
            // Two one-handers that together beat the worn two-hander: mainhand first (the
            // two-hander goes to the bag), the empty offhand is filled on the next pass.
            const pair = weaponsLocked ? null : gr.pairInBag();
            if (pair) {
                const item = character.items[pair.main];
                await equip(pair.main, "mainhand");
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> mainhand (weapon pair, " + Math.round(pair.power) + " together)", "green");
                return;
            }
            // A stronger weapon (e.g. a Phoenix weapon the merchant upgraded for us): the
            // guide only suggests weapons it planned itself.
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                if (weaponsLocked || !item || !gr.strongerWeapon(item)) continue;
                await equip(num, "mainhand");
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> mainhand (stronger weapon)", "green");
                return;
            }
            // Dual wield (warrior): a bag weapon clearly stronger than the one in the offhand.
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                if (weaponsLocked || !item || !gr.strongerOffhand(item)) continue;
                await equip(num, "offhand");
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> offhand (stronger weapon)", "green");
                return;
            }
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                const def = item && G.items[item.name];
                if (!def || !WEARABLE.includes(def.type) || !gr.usable(def)) continue;
                if (gr.isCarry(item.name)) continue;
                const slot = gr.slotsFor(def).find(function (s) { return slotOk(s) && !(character.slots && character.slots[s]) && !equipBlocked(item, s); });
                if (!slot) continue;
                await equip(num, slot);
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> " + slot + " (slot was empty)", "green");
                return;
            }
            // Off-stat jewelry we put on earlier, or a piece on the noEquip list: take it off,
            // the merchant passes it on (and fills the slot with something else).
            if (character.esize > 1) {
                const slot = Object.keys(character.slots || {}).find(function (sl) {
                    if (!slotOk(sl)) return false;
                    const w = character.slots[sl];
                    return w && G.items[w.name] && (offStat(G.items[w.name]) || gr.NO_EQUIP.has(G.items[w.name]));
                });
                if (slot) {
                    const w = character.slots[slot];
                    await unequip(slot);
                    util.log("gear", "took off " + w.name + " +" + (w.level || 0) + " (" + slot + ") - " + (gr.NO_EQUIP.has(G.items[w.name]) ? "on the noEquip list" : "not our main stat"), "yellow");
                    return;
                }
            }
        } catch (e) {
            util.log("gear", "equip failed: " + util.errReason(e), "red");
        } finally {
            // Tell the merchant right away what we wear now: with the 5-min report it still
            // saw the old helmet +7 and started another +8 for us (2026-11-17).
            if (JSON.stringify(gr.worn()) !== wornBefore) gr.nextWishAt = 0;
            gr.equipping = false;
        }
    }
    function trackBag() {
        const now = Date.now();
        const present = {};
        character.items.forEach(function (i) {
            if (!i) return;
            const k = i.name + ":" + (i.level || 0);
            present[k] = true;
            if (!gr.firstSeen[k]) gr.firstSeen[k] = now;
        });
        Object.keys(gr.firstSeen).forEach(function (k) { if (!present[k]) delete gr.firstSeen[k]; });
    }
    function offStat(def) {
        if (!gr.JEWELRY.includes(def.type)) return false;
        const own = (G.classes[character.ctype] || {}).main_stat;
        if (def[own] > 0) return false;
        return gr.MAIN_STATS.some(function (s) { return s !== own && def[s] > 0; });
    }
    // config.gear.minLevel / maxWorn (2026-11-22, gear plan v2): never put on below that level (Dracul's Attire from +7),
    // and at most that many copies worn at once (one Zapper). slot: where it would go (a copy there is replaced).
    function belowMin(item) {
        const min = (cfg.minLevel || {})[item.name];
        return typeof min === "number" && (item.level || 0) < min;
    }
    function overMax(item, slot) {
        const max = (cfg.maxWorn || {})[item.name];
        if (typeof max !== "number") return false;
        const slots = character.slots || {};
        return Object.keys(slots).filter(function (sl) { return sl !== slot && slots[sl] && slots[sl].name === item.name; }).length >= max;
    }
    function equipBlocked(item, slot) { return belowMin(item) || overMax(item, slot) || gr.isLuckOnly(item.name); }

    Object.assign(gr, {
        bagKey: bagKey,
        wrongStat: wrongStat,
        ownStat: ownStat,
        equipPass: equipPass,
        trackBag: trackBag,
        offStat: offStat,
        belowMin: belowMin,
        overMax: overMax,
        equipBlocked: equipBlocked,
    });
};
