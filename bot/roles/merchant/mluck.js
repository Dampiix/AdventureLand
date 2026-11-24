// =====================================================================
// roles/merchant/mluck.js - Merchant's Luck for everyone in reach.
// Part of bot_merchant (module plan, stage 6b): moved verbatim from the old single-file roles/merchant.js. The parts
// share one internal state (mer: pickup requests, busy, trips, the stand, timers) and call each other through mer;
// outside dependencies come in deps (config, util, comms, workshop, scout).
// =====================================================================

module.exports = function install(mer, deps) {
    const config = deps.config;
    const util = deps.util;
    const mlc = (config.merchantRole && config.merchantRole.mluck) || {};

    function mluckTick() {
        if (!mlc.enabled || !G.skills.mluck || character.level < (G.skills.mluck.level || 0)) return;
        if (Date.now() - mer.lastMluck < 500 || !util.canCast("mluck")) return;
        // Never during a channel (Town teleport, fishing, mining): a skill would cancel it.
        if (util.townChannel() || (character.c && (character.c.fishing || character.c.mining))) return;
        if (character.mp < G.skills.mluck.mp + (mlc.mpReserve || 100)) return;
        const refresh = mlc.refreshBelowMs || 30 * 60 * 1000;
        const team = ((config.team && config.team.fighters) || []).concat([character.name]);
        const range = G.skills.mluck.range || 320;
        const needs = function (p) {
            const s = p.s && p.s.mluck;
            if (!s) return 0; // none at all: most urgent
            if (s.f === character.name) return s.ms < refresh ? s.ms : -1;
            if (s.strong) return -1; // another account's own merchant: the server keeps theirs
            return 1;
        };
        const list = [character];
        Object.values(parent.entities || {}).forEach(function (e) {
            if (!e || e.type !== "character" || e.npc || e.rip) return;
            if (!team.includes(e.name) && (!mlc.strangers || e.ctype === "merchant")) return; // merchants loot nothing
            if (util.distanceTo(e) > range) return;
            list.push(e);
        });
        let best = null, bestNeed = Infinity, bestOurs = false;
        list.forEach(function (p) {
            const n = needs(p);
            if (n < 0) return;
            const ours = team.includes(p.name);
            // Our own characters first, then the most urgent.
            if (!best || (ours && !bestOurs) || (ours === bestOurs && n < bestNeed)) { best = p; bestNeed = n; bestOurs = ours; }
        });
        if (!best) return;
        mer.lastMluck = Date.now();
        use_skill("mluck", best === character ? character.name : best.name).catch(function () {});
        mer.mluckCasts++;
        if (Date.now() - mer.mluckSince > 60 * 60 * 1000) {
            util.log("merchant", "Merchant's Luck: " + mer.mluckCasts + " casts in the last hour", "white");
            mer.mluckCasts = 0;
            mer.mluckSince = Date.now();
        }
    }

    Object.assign(mer, {
        mluckTick: mluckTick,
    });
};
