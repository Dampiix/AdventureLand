// =====================================================================
// combat/movement.js - walking to a point without restarting a path walk for a target that moved a bit, a direct step, a free line.
// Part of bot_fighter (module plan, stage 5): moved verbatim from the old single-file core/fighter.js. The parts share
// one internal state (ftr: the farm target, walks, waits, the strike intent, chests) and call each other through ftr;
// outside dependencies come in deps (game, util, config, comms, bus, party, targeting, supply, events, cave, hunts,
// gear, teamStats, cls - the class module).
// =====================================================================

module.exports = function install(ftr, deps) {
    const util = deps.util;
    const quiet = util.quiet;

    // A path walk (xmove -> smart_move behind walls) is not restarted for a target that moved a bit:
    // the priest stood 350 px from the Phoenix in the cave, smart_move searching a path, and a new
    // order every tick for the moving Phoenix cut each search off - it never got going (2026-11-21).
    function moveTo(p) {
        const pathing = typeof smart !== "undefined" && smart.moving;
        if ((is_moving(character) || pathing) && ftr.moveDest && Math.hypot(ftr.moveDest.x - p.x, ftr.moveDest.y - p.y) < (pathing ? 150 : 40)) return;
        ftr.moveDest = { x: p.x, y: p.y };
        quiet(xmove(p.x, p.y));
    }
    function goTo(p) {
        // A direct step in the middle of a path walk: end the walk first (2026-11-21: the priest's
        // spacing steps broke its path walk in the arena every second - "Lost the path..." spam).
        if (typeof smart !== "undefined" && smart.moving) {
            ftr.walks.stopOnPurpose();
            ftr.moveDest = null;
            try { stop("smart"); } catch (e) { /* not walking */ }
        }
        quiet(move(p.x, p.y));
    }
    // Walkable straight line between two points (not only from where we stand).
    // This frame's can_move: the one with the rage walls (2026-11-22 review: kite and escape points used the page's
    // copy and could lie in a rage zone).
    function canMoveFrom(x1, y1, x2, y2) {
        try {
            return !!can_move({ map: character.map, x: x1, y: y1, going_x: x2, going_y: y2, base: character.base });
        } catch (e) { return true; }
    }

    Object.assign(ftr, {
        moveTo: moveTo,
        goTo: goTo,
        canMoveFrom: canMoveFrom,
    });
};
