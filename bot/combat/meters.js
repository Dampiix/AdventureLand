// =====================================================================
// combat/meters.js - the hit, DPS and kill logs (filled by the socket listeners in combat/fighter.js), the /dps and /kills
// reports, the death analysis.
// Part of bot_fighter (module plan, stage 5): moved verbatim from the old single-file core/fighter.js. The parts share
// one internal state (ftr: the farm target, walks, waits, the strike intent, chests) and call each other through ftr;
// outside dependencies come in deps (game, util, config, comms, bus, party, targeting, supply, events, cave, hunts,
// gear, teamStats, cls - the class module).
// =====================================================================

module.exports = function install(ftr, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const PAGE = parent;
    const HIT_LOG_MS = 10 * 1000;
    const meterCfg = config.meter || {};

    function meterReport(force) {
        const now = Date.now();
        if (!force && (!meterCfg.everyMs || now - ftr.lastMeterLog < meterCfg.everyMs)) return;
        ftr.lastMeterLog = now;
        const win = Math.min(meterCfg.windowMs || 5 * 60 * 1000, now - ftr.meterStart);
        if (win < 10 * 1000) return;
        const team = party.enabled ? party.memberNames() : [character.name];
        const per = {}; let total = 0, kills = 0;
        (PAGE.__botDps || []).forEach(function (h) {
            if (now - h.t > win || !team.includes(h.who)) return;
            per[h.who] = (per[h.who] || 0) + h.dmg; total += h.dmg;
            if (h.kill) kills++;
        });
        const sec = win / 1000;
        const parts = Object.keys(per).sort(function (a, b) { return per[b] - per[a]; })
            .map(function (n) { return util.shortName(n) + " " + Math.round(per[n] / sec); });
        util.log("dps", (team.length > 1 ? "team " : "") + Math.round(total / sec) + "/s over " + Math.round(sec / 60 * 10) / 10 + " min" +
            (parts.length > 1 ? " (" + parts.join(", ") + ")" : "") + ", " + kills + " kills", "white");
    }
    function noteTargets() {
        const now = Date.now();
        Object.values(PAGE.entities || {}).forEach(function (e) {
            if (e && e.type === "monster" && !e.dead) PAGE.__botLastTarget[e.id] = { target: e.target || "", mtype: e.mtype, t: now };
        });
        Object.keys(PAGE.__botLastTarget).forEach(function (id) { if (now - PAGE.__botLastTarget[id].t > 60 * 1000) delete PAGE.__botLastTarget[id]; });
    }
    function killReport(force) {
        const now = Date.now();
        const every = (meterCfg.everyMs || 5 * 60 * 1000) * 2;
        if (!force && now - ftr.lastKillLog < every) return;
        ftr.lastKillLog = now;
        const team = party.enabled ? party.memberNames() : [character.name];
        const by = {}, luck = {}; let total = 0;
        (PAGE.__botKills || []).forEach(function (k) {
            if (now - k.t > every) return;
            const key = !k.target ? "none" : team.includes(k.target) ? k.target : "others";
            if (key === "others") return; // other players' fights: not ours
            by[key] = (by[key] || 0) + 1; total++;
            if (typeof k.luckm === "number") { const l = luck[key] = luck[key] || { s: 0, n: 0 }; l.s += k.luckm; l.n++; }
        });
        if (!total) { if (force) util.log("kills", "no kills of ours in the last " + Math.round(every / 60000) + " min", "white"); return; }
        const parts = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })
            .map(function (n) { return util.shortName(n) + " " + by[n] + " (" + Math.round(by[n] / total * 100) + " %" + (luck[n] ? ", luck x" + (luck[n].s / luck[n].n).toFixed(2) : "") + ")"; });
        util.log("kills", "by target at death, last " + Math.round(every / 60000) + " min: " + parts.join(", "), "white");
    }
    function samplePotions() {
        const now = Date.now();
        if (ftr.potSamples.length && now - ftr.potSamples[ftr.potSamples.length - 1].t < 1000) return;
        const names = util.potionNames(config.potions);
        ftr.potSamples.push({ t: now, hp: util.countItem(names.hp), mp: util.countItem(names.mp) });
        while (ftr.potSamples.length && now - ftr.potSamples[0].t > HIT_LOG_MS + 2000) ftr.potSamples.shift();
    }
    function logDeathAnalysis() {
        const now = Date.now();
        const hits = (PAGE.__botHits || []).filter(function (h) { return now - h.t <= HIT_LOG_MS; });
        const by = {};
        hits.forEach(function (h) { const b = by[h.who] = by[h.who] || { n: 0, dmg: 0 }; b.n++; b.dmg += h.dmg; });
        const parts = Object.keys(by).sort(function (a, b) { return by[b].dmg - by[a].dmg; })
            .map(function (k) { return k + ": " + by[k].n + " hits " + by[k].dmg; });
        const first = ftr.potSamples[0], last = ftr.potSamples[ftr.potSamples.length - 1];
        const pots = first && last ? (first.hp - last.hp) + " HP / " + (first.mp - last.mp) + " MP potions" : "potions unknown";
        const total = hits.reduce(function (s, h) { return s + h.dmg; }, 0);
        util.log("death", "last 10 s: " + total + " damage (" + (parts.join(", ") || "no hits seen") + "), " + pots, "red");
    }

    Object.assign(ftr, {
        meterReport: meterReport,
        noteTargets: noteTargets,
        killReport: killReport,
        samplePotions: samplePotions,
        logDeathAnalysis: logDeathAnalysis,
    });
};
