// =====================================================================
// classes/mage/blink.js - Blink on routes. Blink has no range limit on the server (any point of the same map; a test
// blinked 980 px and landed 35 px off). On a path walk (smart_move, path found) we jump to the farthest step of the
// plan on this map - the next door or the goal - when it is at least minDist px away, our MP stays above keepMp after
// the 1,600-MP cast (Magiport needs 900 a member), nothing attacks us and the manual rules are off. Never into a farm
// spot: the farthest step outside it (the spot check comes first). The steps up to the landing point are dropped from
// the plan; once landed we go on with the farthest step of this map we can walk to straight (the server lands us on the
// nearest safe spot, sometimes behind an edge - "Lost the path..." in the arena).
// Interface: createBlink(deps, options) -> { tick() }
//   deps: game, log, errReason, attackersOnMe(), manual() -> true under the manual rules,
//         farmType() -> the monster whose spot we must not blink into (or null), inSpotArea(point, type)
//   options: see DEFAULTS
// Works for any class that has the skill.
// =====================================================================

const DEFAULTS = {
    enabled: true,
    minDist: 400,   // jump only this far or farther
    keepMp: 0.4,    // MP share left after the cast
};

module.exports = function createBlink(deps, options) {
    const game = deps.game;
    const bt = Object.assign({}, DEFAULTS, options || {});
    let blinkLogAt = 0, blinkCount = 0, blinkPx = 0, blinkBusyUntil = 0;

    function tick() {
        const me = game.me(), G = game.data();
        if (!bt.enabled || me.rip || Date.now() < blinkBusyUntil) return;
        const smart = game.path();
        if (!smart || !smart.moving || !smart.found || smart.town || !Array.isArray(smart.plot) || !smart.plot.length) return;
        if (deps.manual()) return;
        if (!G.skills.blink || !game.canCast("blink")) return;
        if ((me.mp - (G.skills.blink.mp || 1600)) / Math.max(1, me.max_mp) < (bt.keepMp || 0.4)) return;
        if (deps.attackersOnMe().length) return;
        if (game.transporting(me)) return;
        // The last step of the plan on our map before a door, town or another map.
        let k = -1;
        for (let i = 0; i < smart.plot.length; i++) {
            const p = smart.plot[i];
            if (!p || p.town || p.transport || p.map !== me.map) break;
            k = i;
        }
        if (k < 0) return;
        const farmType = deps.farmType();
        const inSpot = function (p) { return !!(farmType && deps.inSpotArea({ map: me.map, x: p.x, y: p.y }, farmType)); };
        while (k >= 0 && inSpot(smart.plot[k])) k--;
        if (k < 0) return;
        const to = smart.plot[k];
        const d = Math.hypot(to.x - me.real_x, to.y - me.real_y);
        if (d < (bt.minDist || 400)) return;
        blinkBusyUntil = Date.now() + 1500;
        Promise.resolve(game.useSkill("blink", [Math.round(to.x), Math.round(to.y)])).then(function () {
            // Landed (200 ms): the plan goes on from the landing point.
            const s = game.path();
            if (s && s.moving && Array.isArray(s.plot)) {
                const idx = s.plot.indexOf(to);
                if (idx > 0) s.plot.splice(0, idx);
            }
            setTimeout(function () {
                try {
                    const s2 = game.path();
                    if (!s2 || !s2.moving || !Array.isArray(s2.plot) || !s2.plot.length) return;
                    let best = -1;
                    for (let i = 0; i < s2.plot.length; i++) {
                        const p = s2.plot[i];
                        if (!p || p.town || p.transport || p.map !== game.me().map) break;
                        if (game.canMoveTo(p.x, p.y)) best = i;
                    }
                    if (best > 0) s2.plot.splice(0, best);
                } catch (e) { /* the plan as it is */ }
            }, 350);
            blinkCount++;
            blinkPx += d;
            if (Date.now() - blinkLogAt > 60 * 1000) {
                blinkLogAt = Date.now();
                deps.log("mage", "Blink on the way: " + Math.round(d) + " px on " + game.me().map + " (" + blinkCount + " blinks, " + Math.round(blinkPx) + " px since start)", "white");
            }
        }).catch(function (e) {
            blinkBusyUntil = Date.now() + 10 * 1000; // a refused blink (e.g. no safe spot there): not again right away
            deps.log("mage", "Blink on the way refused: " + deps.errReason(e), "orange");
        });
    }

    return { tick: tick };
};
