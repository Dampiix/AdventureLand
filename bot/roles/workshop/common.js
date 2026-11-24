// =====================================================================
// roles/workshop/common.js - shared helpers: the team and who is online, target levels, NPC positions, walking to an NPC, boost, bag index, main stats.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    // Armor that can carry a stat always gets the fighter's main stat (str/int/dex),
    // even when the guide's wish names none: a piece without it would never replace
    // a worn piece that has one, and the guide's lessons want it anyway.
    function withMainStat(fighter, w) {
        if (w.stat || !cfg.mainStatOnArmor || !G.items[w.name] || !G.items[w.name].stat) return w;
        const cls = wks.classes[fighter] && G.classes[wks.classes[fighter]];
        return cls && cls.main_stat ? Object.assign({}, w, { stat: cls.main_stat }) : w;
    }
    function isOnline(f) {
        const c = wks.onlineCache[f];
        if (c && Date.now() - c.t < 5000) return c.v;
        let v = true;
        try { const b = get("bot_beat:" + f); v = !!(b && b.at && Date.now() - b.at < (cfg.onlineMs || 10 * 60 * 1000)); } catch (e) { /* storage unavailable: count it */ }
        wks.onlineCache[f] = { t: Date.now(), v: v };
        return v;
    }
    function activeTeam() { return ((config.team && config.team.fighters) || []).filter(isOnline); }
    function allFighters() {
        return Object.keys(Object.assign({}, wks.wishes, cfg.wishes || {}));
    }
    function fighters() { return allFighters().filter(isOnline); }

    // The level a wish is fulfilled at: the wished one, or where we had to stop.
    function targetLevel(fighter, w) {
        const r = wks.reachedOnly[wks.key(fighter, w)];
        return r !== undefined ? r : w.level;
    }

    // Where an NPC stands: main first, then any other regular map (e.g. the witch).
    function npcPos(id) {
        const maps = ["main"].concat(Object.keys(G.maps).filter(function (m) { return m !== "main"; }));
        for (const mapName of maps) {
            const map = G.maps[mapName];
            if (!map || map.ignore || map.instance) continue;
            const npc = (map.npcs || []).find(function (n) { return n.id === id && n.position; });
            if (npc) return { map: mapName, x: npc.position[0], y: npc.position[1] };
        }
        return null;
    }

    async function goTo(npcId) {
        const p = npcPos(npcId);
        if (!p) throw { reason: "npc " + npcId + " not found" };
        // Market stand (config.merchantRole.stand): an NPC within the server's 400 px of the
        // home spot is used from there - we walk home instead of to the NPC, so the stand
        // reopens and Merrit's two minutes keep running. After a bank trip the merchant had
        // walked on to Lucas and the upgrade NPC with his stand closed (2026-11-17).
        const st = config.merchantRole.stand || {};
        const hasStand = st.enabled && st.home &&
            character.items.some(function (i) { return i && G.items[i.name] && G.items[i.name].type === "stand"; });
        if (hasStand && p.map === "main") {
            const home = { map: "main", x: st.home.x, y: st.home.y };
            const reach = st.reach || 390;
            if (Math.hypot(p.x - home.x, p.y - home.y) < reach) {
                if (character.map !== "main" || util.distanceTo(home) >= 15) await util.walk(home);
                if (!character.stand) {
                    try { util.openStand(); } catch (e) { /* the merchant's round opens it again */ }
                }
                return;
            }
        }
        if (character.map === p.map && util.distanceTo(p) < 100) return;
        await util.walk(p);
    }

    // Mass Production (lvl 30, -50%; "pp" from lvl 60, -90%) before an upgrade or compound,
    // Mass Exchange (lvl 40 / 70) before an exchange: the next one finishes faster.
    async function boost(skill) {
        try {
            if (!cfg.massSkills || (character.s && (character.s[skill] || character.s[skill + "pp"]))) return;
            const pick = util.canCast(skill + "pp") ? skill + "pp" : util.canCast(skill) ? skill : null;
            if (pick) await use_skill(pick);
        } catch (e) {
            // a speed-up is never worth failing the upgrade for
        }
    }

    function bagIndex(name, minLevel) {
        let best = -1;
        character.items.forEach(function (item, i) {
            if (!item || item.name !== name || (item.level || 0) < minLevel) return;
            if (best === -1 || (item.level || 0) < (character.items[best].level || 0)) best = i; // smallest that satisfies
        });
        return best;
    }

    Object.assign(wks, {
        withMainStat: withMainStat,
        isOnline: isOnline,
        activeTeam: activeTeam,
        allFighters: allFighters,
        fighters: fighters,
        targetLevel: targetLevel,
        npcPos: npcPos,
        goTo: goTo,
        boost: boost,
        bagIndex: bagIndex,
    });
};
