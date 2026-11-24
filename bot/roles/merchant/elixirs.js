// =====================================================================
// roles/merchant/elixirs.js - elixirs for the team.
// Part of bot_merchant (module plan, stage 6b): moved verbatim from the old single-file roles/merchant.js. The parts
// share one internal state (mer: pickup requests, busy, trips, the stand, timers) and call each other through mer;
// outside dependencies come in deps (config, util, comms, workshop, scout).
// =====================================================================

module.exports = function install(mer, deps) {
    const config = deps.config;
    const util = deps.util;
    const m = config.merchantRole;
    const workshop = deps.workshop;

    // ---- elixirs (v1.229.0, config.elixirs) ------------------------------------------------------------------------
    // The elixirs our team drinks (one per class in config.team.fighters, classes as the fighters reported them).
    function teamElixirs() {
        const el = config.elixirs || {};
        if (!el.enabled) return [];
        const out = [];
        ((config.team && config.team.fighters) || []).forEach(function (f) {
            const ctype = workshop.classOf ? workshop.classOf(f) : null;
            const it = ctype && (el.byClass || {})[ctype];
            if (it && G.items[it] && !out.includes(it)) out.push(it);
        });
        return out;
    }
    function sellerNpc(name) {
        for (const mapName of ["main"].concat(Object.keys(G.maps).filter(function (x) { return x !== "main"; }))) {
            const map = G.maps[mapName];
            if (!map || map.ignore || map.instance) continue;
            const npc = (map.npcs || []).find(function (n) { return n.position && G.npcs[n.id] && (G.npcs[n.id].items || []).includes(name); });
            if (npc) return { id: npc.id, map: mapName, x: npc.position[0], y: npc.position[1] };
        }
        return null;
    }
    async function elixirChores() {
        const el = config.elixirs || {};
        if (!el.enabled) return;
        const team = teamElixirs();
        for (const name of Object.keys(el.buy || {})) {
            const rule = el.buy[name] || {};
            if (!team.includes(name) || !G.items[name]) continue;
            const owned = workshop.ownedCount(name);
            if (owned >= (rule.min || 1)) continue;
            const price = G.items[name].g;
            const spendable = Math.max(0, character.gold - util.goldAmount(m.goldReserve));
            const amount = Math.min((rule.max || rule.min || 1) - owned, Math.floor(spendable / price));
            if (amount < 1) {
                if (Date.now() - (mer.elixirPoorLog[name] || 0) > 30 * 60 * 1000) {
                    mer.elixirPoorLog[name] = Date.now();
                    util.log("merchant", "only " + owned + " " + G.items[name].name + " left - not enough gold above the reserve for one (" + Math.round(price / 1000) + "k)", "orange");
                }
                continue;
            }
            if (character.esize < 1 && util.findItemIndex(function (i) { return i.name === name; }) === -1) continue;
            const npc = sellerNpc(name);
            if (!npc) continue;
            util.status("buying " + G.items[name].name, "yellow");
            util.log("merchant", "buying " + amount + " " + G.items[name].name + " at " + (G.npcs[npc.id].name || npc.id) + " (" + npc.map + ") for " + Math.round(amount * price / 1000) + "k - " + owned + " left", "yellow");
            // Where to stand (v1.229.1): Warin stands behind his bar - a point 20 px below him was "Path not found!".
            // The map's spawn point nearest to the NPC (within 300 px, the shop reach is 400) is walkable by definition.
            const spawn = ((G.maps[npc.map] || {}).spawns || []).map(function (s) { return { x: s[0], y: s[1], d: Math.hypot(s[0] - npc.x, s[1] - npc.y) }; })
                .filter(function (s) { return s.d <= 300; }).sort(function (a, b) { return a.d - b.d; })[0];
            await util.walk(spawn ? { map: npc.map, x: spawn.x, y: spawn.y } : { map: npc.map, x: npc.x, y: npc.y + 20 });
            await buy(name, amount);
            util.log("merchant", "bought " + amount + " " + G.items[name].name, "green");
        }
    }

    Object.assign(mer, {
        teamElixirs: teamElixirs,
        sellerNpc: sellerNpc,
        elixirChores: elixirChores,
    });
};
