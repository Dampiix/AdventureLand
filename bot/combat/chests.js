// =====================================================================
// combat/chests.js - the chest opener: the fighter with the highest gold bonus opens party chests; gold and luck multipliers shared.
// Part of bot_fighter (module plan, stage 5): moved verbatim from the old single-file core/fighter.js. The parts share
// one internal state (ftr: the farm target, walks, waits, the strike intent, chests) and call each other through ftr;
// outside dependencies come in deps (game, util, config, comms, bus, party, targeting, supply, events, cave, hunts,
// gear, teamStats, cls - the class module).
// =====================================================================

module.exports = function install(ftr, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const co = (config.party && config.party.chestOpener) || {};

    function shareGold() {
        const now = Date.now();
        const team = (config.team && config.team.fighters) || [];
        const others = party.memberNames().filter(function (n) { return n !== character.name && team.includes(n); });
        if (party.isLeader) {
            // The leader tells everyone its choice: every 5 s, at once when it changes.
            const op = chooseOpener();
            if (op !== ftr.lastOpenerSent || now - ftr.lastOpenerSend > 5000) {
                ftr.lastOpenerSent = op;
                ftr.lastOpenerSend = now;
                others.forEach(function (n) { deps.comms.send(n, "opener", { name: op }); });
            }
        }
        if (now - ftr.lastGoldSend < 30 * 1000) return;
        ftr.lastGoldSend = now;
        if (!party.isLeader && config.leader && others.includes(config.leader)) deps.comms.send(config.leader, "goldm", { g: character.goldm || 1, l: character.luckm || 1 });
    }
    // Members: the leader's choice while it is fresh; the leader (or without it): our own.
    function chestOpener() {
        if (!party.isLeader && ftr.leaderOpener && Date.now() - ftr.leaderOpener.at < 30 * 1000) return ftr.leaderOpener.name;
        return chooseOpener();
    }
    // The fighter that opens chests: config fixed one, else the highest gold multiplier among
    // the team fighters in the party (reports younger than 3 min); ties: the leader, then team order.
    function chooseOpener() {
        const team = (config.team && config.team.fighters) || [];
        const here = team.filter(function (n) { return n === character.name || party.memberNames().includes(n); });
        if (co.fixed && here.includes(co.fixed)) return co.fixed;
        let best = null, bestG = -1;
        const order = [config.leader].concat(team).filter(function (n, i, a) { return n && a.indexOf(n) === i && here.includes(n); });
        order.forEach(function (n) {
            const g = n === character.name ? (character.goldm || 1)
                : (ftr.goldOf[n] && Date.now() - ftr.goldOf[n].at < 3 * 60 * 1000 ? ftr.goldOf[n].g : null);
            if (g !== null && g > bestG + 1e-9) { best = n; bestG = g; }
        });
        return best || character.name;
    }
    function openerAway(name, chest) {
        if (name === character.name) return false;
        const p = get_player(name);
        if (!p || p.rip || (p.map && p.map !== character.map)) return true;
        return Math.hypot((p.x || 0) - chest.x, (p.y || 0) - chest.y) > (co.awayRange || 400);
    }
    function lootChests() {
        if (!co.enabled || !party.enabled) { loot(); return; }
        shareGold();
        const now = Date.now();
        if (now - ftr.lastLootAt < Math.min(300, (character.ping || 100) * 3)) return;
        const opener = chestOpener();
        const ids = Object.keys(parent.chests || {});
        Object.keys(ftr.chestSeen).forEach(function (id) { if (!ids.includes(id)) delete ftr.chestSeen[id]; });
        // Diagnosis (2026-11-20: a pile of chests stayed behind): any fighter with chests older than
        // twice fallbackMs says what it sees - at most every 2 min.
        if (now - ftr.lastStuckLog > 2 * 60 * 1000) {
            const oldIds = ids.filter(function (id) { return ftr.chestSeen[id] && now - ftr.chestSeen[id] > 2 * (co.fallbackMs || 10000); });
            if (oldIds.length >= 3) {
                ftr.lastStuckLog = now;
                const c0 = parent.chests[oldIds[0]] || {};
                const fromLeader = !party.isLeader && ftr.leaderOpener && now - ftr.leaderOpener.at < 30 * 1000;
                util.log("loot", oldIds.length + " chests older than " + Math.round(2 * (co.fallbackMs || 10000) / 1000) + " s - opener " + opener +
                    (opener === character.name ? " (us)" : " (away: " + openerAway(opener, c0) + ")") + ", choice from " + (fromLeader ? "leader" : "own") +
                    ", first at " + Math.round(Math.hypot((c0.x || 0) - character.x, (c0.y || 0) - character.y)) + " px, items " + (c0.items || 0) + "/" + character.esize, "orange");
            }
        }
        let opened = 0;
        for (let i = 0; i < ids.length && opened < 2; i++) {
            const id = ids[i], chest = parent.chests[id];
            if (!chest) continue;
            if (!ftr.chestSeen[id]) ftr.chestSeen[id] = now;
            if ((chest.items || 0) > character.esize || (chest.last_loot && now - chest.last_loot < 1600)) continue;
            if (opener !== character.name && !openerAway(opener, chest) && now - ftr.chestSeen[id] < (co.fallbackMs || 30000)) continue;
            chest.last_loot = now;
            ftr.lastLootAt = now;
            opened++;
            try { Promise.resolve(loot(id)).catch(function () {}); } catch (e) { /* chest gone */ }
        }
    }

    Object.assign(ftr, {
        shareGold: shareGold,
        chestOpener: chestOpener,
        chooseOpener: chooseOpener,
        openerAway: openerAway,
        lootChests: lootChests,
    });
};
