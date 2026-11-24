// =====================================================================
// gear/luck-swap.js - the luck swap: luck gear on for a dying monster, the usual gear back after.
// Part of bot_gear (module plan, stage 7a): moved verbatim from the old single-file core/gear.js. The parts share
// one internal state (gr: wishes, the luck swap, held weapons, timers) and call each other through gr; outside
// dependencies come in deps (config, util, comms, supply, WEARABLE).
// =====================================================================

module.exports = function install(gr, deps) {
    const config = deps.config;
    const util = deps.util;
    const LS = ((config.classes || {})[character.ctype] || {}).luckSwap || null;

    function luckNames() { return LS && LS.enabled ? (LS.items || []) : []; }
    // Luck pieces that are only worn by the swap (not the Wanderer's pieces, which are normal gear until replaced).
    function isLuckOnly(name) {
        if (!luckNames().includes(name)) return false;
        const steps = gr.chainOf(name);
        return !!(steps && steps.carry);
    }
    function bestBagIndex(name, skip) {
        let best = -1;
        character.items.forEach(function (it, i) {
            if (!it || it.name !== name || (skip && skip.includes(i))) return;
            if (best === -1 || (it.level || 0) > (character.items[best].level || 0)) best = i;
        });
        return best;
    }
    // How often a luck piece is listed (2026-11-23: two Clover Studs, one for each earring slot).
    function luckCount(name) { return luckNames().filter(function (n) { return n === name; }).length; }
    function luckOn(ms) {
        const names = luckNames();
        if (!names.length) return false;
        const batch = [], back = [];
        names.filter(function (n, i) { return names.indexOf(n) === i; }).forEach(function (name) {
            const def = G.items[name];
            const slots = def && gr.SLOTS_BY_TYPE[def.type];
            if (!slots || !gr.usable(def)) return;
            const wearing = function (sl) { return !!(character.slots && character.slots[sl] && character.slots[sl].name === name); };
            // Listed twice: both paired slots (earring2 first, then earring1); once: the last slot (ring2 / earring2).
            let need = Math.min(luckCount(name), slots.length) - slots.filter(wearing).length;
            const free = slots.slice().reverse().filter(function (sl) { return !wearing(sl); });
            for (const slot of free) {
                if (need <= 0) break;
                if (batch.some(function (b) { return b.slot === slot; })) continue;
                const num = bestBagIndex(name, batch.map(function (b) { return b.num; }));
                if (num === -1) break; // not there yet
                const was = character.slots && character.slots[slot];
                batch.push({ num: num, slot: slot });
                back.push({ slot: slot, name: was ? was.name : null, level: was ? (was.level || 0) : 0 });
                need--;
            }
        });
        if (batch.length) {
            gr.quiet(equip_batch(batch));
            if (!gr.luck) util.log("gear", "luck gear on: " + batch.map(function (b) { return character.items[b.num].name; }).join(", "), "white");
        }
        if (!batch.length && !gr.luck) return false;
        gr.luck = { until: Date.now() + (ms || LS.backMs || 3000), back: (gr.luck ? gr.luck.back : []).concat(back) };
        gr.lockedUntil = gr.luck.until + 2000;
        return true;
    }
    function luckBack() {
        const batch = [], used = [];
        gr.luck.back.forEach(function (b) {
            if (!b.name) return; // the slot was empty: the luck piece stays (nothing to put back)
            let num = -1;
            character.items.forEach(function (it, i) {
                if (num === -1 && it && it.name === b.name && (it.level || 0) === b.level && !used.includes(i)) num = i;
            });
            if (num === -1) return;
            used.push(num);
            batch.push({ num: num, slot: b.slot });
        });
        if (batch.length) gr.quiet(equip_batch(batch));
        gr.luck = null;
        gr.lockedUntil = Date.now() + 1500; // the bag settles before the next equip pass
    }

    Object.assign(gr, {
        luckNames: luckNames,
        isLuckOnly: isLuckOnly,
        bestBagIndex: bestBagIndex,
        luckCount: luckCount,
        luckOn: luckOn,
        luckBack: luckBack,
    });
};
