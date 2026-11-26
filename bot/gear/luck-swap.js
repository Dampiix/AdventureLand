// =====================================================================
// gear/luck-swap.js - the luck swap: luck gear on for a dying monster, the usual gear back after.
// Part of bot_gear (module plan, stage 7a): moved verbatim from the old single-file core/gear.js. The parts share
// one internal state (gr: wishes, the luck swap, held weapons, timers) and call each other through gr; outside
// dependencies come in deps (config, util, comms, WEARABLE).
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
    // ids (v1.238.8, player decision 2026-11-26): the monsters whose death the luck is for - the gear comes back as soon as
    // all of them are dead or gone (at least LS.minMs after the swap), at the latest after ms / LS.backMs. The drops are
    // rolled at the death, so the luck is not needed after it (before: always backMs, also when they died at once, and
    // a kill later than backMs got no luck). Without ids: the time only, as before.
    function luckOn(ms, ids) {
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
        const prev = gr.luck;
        // One call without ids (time only) keeps the gear on for the full time; the ids of all calls are waited for.
        const watch = (prev && !prev.ids) || !Array.isArray(ids) || !ids.length ? null
            : (prev ? prev.ids : []).concat(ids.map(String).filter(function (id) { return !(prev && prev.ids.includes(id)); }));
        gr.luck = { until: Date.now() + (ms || LS.backMs || 3000), last: Date.now(), ids: watch,
            back: (prev ? prev.back : []).concat(back) };
        gr.lockedUntil = gr.luck.until + 2000;
        return true;
    }
    // Time to change back: the time is up, or every watched monster is dead or out of sight (not before LS.minMs).
    function luckDone() {
        const l = gr.luck;
        if (!l) return false;
        if (Date.now() >= l.until) return true;
        if (!l.ids || !l.ids.length || Date.now() - l.last < (LS.minMs || 500)) return false;
        return l.ids.every(function (id) {
            const e = (typeof parent !== "undefined" && parent.entities) ? parent.entities[id] : null;
            return !e || e.dead || e.rip;
        });
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
        luckDone: luckDone,
    });
};
