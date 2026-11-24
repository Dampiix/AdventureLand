// =====================================================================
// events/giga-crab.js - fleeing a Giga Crab on us (events.foreignRules[type].flee).
// Part of bot_fighter (module plan, stage 5): moved verbatim from the old single-file core/fighter.js. The parts share
// one internal state (ftr: the farm target, walks, waits, the strike intent, chests) and call each other through ftr;
// outside dependencies come in deps (game, util, config, comms, bus, party, targeting, supply, events, cave, hunts,
// gear, teamStats, cls - the class module).
// =====================================================================

module.exports = function install(ftr, deps) {
    const config = deps.config;
    const util = deps.util;

    function gigaFlee() {
        const fr = (config.events && config.events.foreignRules) || {};
        const crab = Object.values(parent.entities || {}).find(function (e) {
            return e && e.type === "monster" && !e.dead && e.target === character.name && fr[e.mtype] && fr[e.mtype].flee;
        });
        if (!crab || character.rip) return false;
        const r = fr[crab.mtype];
        const me = { x: character.real_x, y: character.real_y };
        const base = Math.atan2(me.y - crab.y, me.x - crab.x);
        const step = r.fleeStep || 250;
        let to = null;
        [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2].some(function (da) {
            const p = { x: me.x + Math.cos(base + da) * step, y: me.y + Math.sin(base + da) * step };
            if (can_move_to(p.x, p.y)) { to = p; return true; }
            return false;
        });
        const now = Date.now();
        if (now - ftr.gigaLogAt > 5000) {
            ftr.gigaLogAt = now;
            util.log("event", (G.monsters[crab.mtype] || {}).name + " is on me (" + Math.round(util.distanceTo(crab)) + " px) - fleeing" + (to ? "" : ", no free way"), "red");
        }
        util.status("fleeing " + crab.mtype, "red");
        if (!to) return true;
        if (character.ctype === "mage" && r.blink !== false && util.canCast("blink")) {
            Promise.resolve(use_skill("blink", [Math.round(to.x), Math.round(to.y)])).catch(function () {});
            return true;
        }
        if (now - ftr.gigaMoveAt > 500) {
            ftr.gigaMoveAt = now;
            try { Promise.resolve(xmove(to.x, to.y)).catch(function () {}); } catch (e) { /* next tick */ }
        }
        return true;
    }

    Object.assign(ftr, {
        gigaFlee: gigaFlee,
    });
};
