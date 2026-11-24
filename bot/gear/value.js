// =====================================================================
// gear/value.js - the value of gear: XP per hour, power from stats and attack, the gain of a piece.
// Part of bot_gear (module plan, stage 7a): moved verbatim from the old single-file core/gear.js. The parts share
// one internal state (gr: wishes, the luck swap, held weapons, timers) and call each other through gr; outside
// dependencies come in deps (config, util, comms, supply, WEARABLE).
// =====================================================================

module.exports = function install(gr, deps) {


    function trackXp() {
        const now = Date.now();
        const last = gr.xpSamples[gr.xpSamples.length - 1];
        if (last && now - last.t < 60 * 1000) return;
        gr.xpSamples.push({ t: now, xp: character.xp, level: character.level });
        while (gr.xpSamples.length && now - gr.xpSamples[0].t > 60 * 60 * 1000) gr.xpSamples.shift();
    }
    function xpPerHour() {
        if (gr.xpSamples.length < 10) return null;
        const a = gr.xpSamples[0], b = gr.xpSamples[gr.xpSamples.length - 1];
        let gained = b.xp - a.xp;
        if (b.level > a.level) {
            gained = (G.levels[a.level] || 0) - a.xp + b.xp;
            for (let l = a.level + 1; l < b.level; l++) gained += G.levels[l] || 0;
        }
        const h = (b.t - a.t) / 3600000;
        return h > 0 ? Math.max(0, gained) / h : null;
    }
    function mainStat() { return (G.classes[character.ctype] || {}).main_stat || "str"; }
    function levelPower() {
        const ls = (G.classes[character.ctype] || {}).lstats || {};
        const main = mainStat();
        const freq = (character.level < 80 ? 1 / 164 : 0) + (ls.dex || 0) / 640 + (ls.int || 0) / 1575;
        return (ls[main] || 1) / Math.max(1, character[main] || 1) + freq / Math.max(0.1, character.frequency || 1);
    }
    function xpValue() {
        const xph = xpPerHour();
        const lp = levelPower();
        return { xpPerHour: xph === null ? null : Math.round(xph), levelPower: Math.round(lp * 10000) / 100,
            xpPower: xph === null ? null : Math.round(xph / Math.max(1, character.max_xp) * lp * 10000) / 100,
            // for the merchant's gain estimates of items we don't wish for (Ponty finds)
            base: { stat: mainStat(), mainVal: character[mainStat()] || 1, atk: weaponAttack(), freq: character.frequency || 1 } };
    }
    function propsOf(it) {
        try { return calculate_item_properties(it) || {}; } catch (e) { return {}; }
    }
    function weaponAttack() {
        const m = character.slots && character.slots.mainhand, o = character.slots && character.slots.offhand;
        let a = m ? (propsOf(m).attack || 0) : 0;
        if (o && G.items[o.name] && G.items[o.name].type === "weapon") a += 0.7 * (propsOf(o).attack || 0);
        return Math.max(5, a);
    }
    function powerParts(p, main) {
        return { stat: p[main] || 0, atk: p.attack || 0, freq: (p.frequency || 0) / 100 + (p.dex || 0) / 640 + (p.int || 0) / 1575 };
    }
    // % more power from the wished piece, or null (carried mode weapons, unknown slots).
    function gainOf(w) {
        const def = G.items[w.name];
        if (!def || gr.isCarry(w.name)) return null;
        const slots = gr.SLOTS_BY_TYPE[def.type] || [];
        if (!slots.length) return null;
        const main = mainStat();
        const cand = { name: w.name, level: w.level || 0 };
        if (w.stat) cand.stat_type = w.stat;
        const pn = powerParts(propsOf(cand), main);
        let best = null;
        slots.forEach(function (s) {
            const it = character.slots && character.slots[s];
            const pw = it ? powerParts(propsOf(it), main) : { stat: 0, atk: 0, freq: 0 };
            const g = (pn.stat - pw.stat) / Math.max(1, character[main] || 1) +
                (pn.atk - pw.atk) * (s === "offhand" ? 0.7 : 1) / weaponAttack() +
                (pn.freq - pw.freq) / Math.max(0.1, character.frequency || 1);
            if (best === null || g > best) best = g;
        });
        return best === null ? null : Math.round(best * 10000) / 100;
    }

    Object.assign(gr, {
        trackXp: trackXp,
        xpPerHour: xpPerHour,
        mainStat: mainStat,
        levelPower: levelPower,
        xpValue: xpValue,
        propsOf: propsOf,
        weaponAttack: weaponAttack,
        powerParts: powerParts,
        gainOf: gainOf,
    });
};
