// =====================================================================
// safety/spots.js - where a farm spot is (module plan, stage 4a; moved out of core/targeting.js unchanged). Pure: no
// state, so every bundle may carry its own copy.
//   watchPoint(type)     where to wait for a lone one: just outside the nearest spawn box of the kind on our map
//                        (isolation.watchMargin px out; the rage box where the spawn has one), or null
//   inSpotArea(p, type)  p within the spot check's edge of a spawn of this type (on p's map)
//   spotBox(type, spot)  the spawn box (with its rage box) whose middle is the spot, or null; .rage: the whole spawn
//                        comes at once there (monsters/monsters.js wholeSpawn - "auto": the spawn has a rage box)
//   boxDist(p, b)        distance of a point from a box (0 inside)
// deps: { game, util, config } - config.targeting.isolation and .spotCheck are read when used.
// =====================================================================

const MONSTERS = require("../monsters/monsters.js");

module.exports = function createSpots(deps) {
    const game = deps.game, util = deps.util;
    function cfg() { return deps.config.targeting; }

    // Where to wait for a lone one: just outside the edge of the nearest spawn box of the kind on our map,
    // isolation.watchMargin px out - close enough to see the whole box, far enough not to draw aggro.
    function watchPoint(type) {
        const character = game.me(), G = game.data();
        const icfg = cfg().isolation || {};
        const me = util.xy(character);
        const margin = icfg.watchMargin || 150;
        let best = null, bestD = Infinity;
        ((G.maps[character.map] || {}).monsters || []).forEach(function (pack) {
            if (pack.type !== type) return;
            // A spawn with a rage zone (map data "rage"): every 4.2 s each free monster of that spawn goes for a
            // player standing inside it - wait outside that.
            const boxes = pack.rage ? [pack.rage] : util.spawnBoxes(pack, character.map);
            boxes.forEach(function (b) {
                const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
                // Nearest point of the box, then margin px further out along the way from its center.
                const nx = Math.max(b[0], Math.min(b[2], me.x)), ny = Math.max(b[1], Math.min(b[3], me.y));
                let dx = nx - cx, dy = ny - cy;
                const len = Math.hypot(dx, dy) || 1;
                const p = { map: character.map, x: Math.round(nx + dx / len * margin), y: Math.round(ny + dy / len * margin) };
                const d = Math.hypot(p.x - me.x, p.y - me.y);
                if (d < bestD && game.canMoveTo(p.x, p.y)) { bestD = d; best = p; }
            });
        });
        return best;
    }
    function spotBox(type, spot) {
        const G = game.data();
        const map = G.maps[spot.map];
        let box = null;
        ((map && map.monsters) || []).forEach(function (pack) {
            if (box || pack.type !== type) return;
            const boxes = util.spawnBoxes(pack, spot.map);
            boxes.forEach(function (b) {
                if (box || Math.round((b[0] + b[2]) / 2) !== spot.x || Math.round((b[1] + b[3]) / 2) !== spot.y) return;
                // Spawn box and rage box together, whichever reaches farther out. rage: the whole spawn comes at once
                // (the monster rules: by default where the spawn has a rage box).
                const r = pack.rage;
                const u = r ? [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])] : b;
                box = { b: u, rage: MONSTERS.wholeSpawn(type, pack), count: pack.count || 1 };
            });
        });
        return box;
    }
    function boxDist(p, b) {
        const dx = Math.max(b[0] - p.x, 0, p.x - b[2]), dy = Math.max(b[1] - p.y, 0, p.y - b[3]);
        return Math.hypot(dx, dy);
    }
    // Is p (on our map, or p.map) within the spot check's edge of a spawn of this type? (party.travelDest, atGoal)
    function inSpotArea(p, type) {
        const G = game.data();
        const gcfg = cfg().spotCheck || {};
        const def = G.monsters[type];
        if (!def || !p) return false;
        const margin = Math.max(gcfg.margin || 150, Math.min((def.range || 0) + 50, gcfg.maxMargin || 450));
        const mapName = p.map || game.me().map;
        return ((G.maps[mapName] || {}).monsters || []).some(function (pk) {
            if (pk.type !== type) return false;
            const boxes = util.spawnBoxes(pk, mapName);
            if (pk.rage) boxes.push(pk.rage);
            return boxes.some(function (b) { return boxDist(p, b) < margin; });
        });
    }

    return { watchPoint: watchPoint, inSpotArea: inSpotArea, spotBox: spotBox, boxDist: boxDist };
};
