// =====================================================================
// lib/geometry.js - Positions and distances: xy, distanceTo, isNear, spawn boxes.
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

// The spawn boxes [x1, y1, x2, y2] of a map's monster pack (map.monsters entry) on that map.
function spawnBoxes(pack, mapName) {
    if (!pack) return [];
    if (pack.boundaries) return pack.boundaries.filter(function (b) { return !mapName || b[0] === mapName; }).map(function (b) { return b.slice(1); });
    return pack.boundary ? [pack.boundary] : [];
}

// Position of an entity or point. Client entities carry real_x/real_y,
// Mainframe and plain points only x/y.
function xy(e) {
    return {
        x: e.real_x !== undefined ? e.real_x : e.x,
        y: e.real_y !== undefined ? e.real_y : e.y,
    };
}

function distanceTo(point) {
    const p = xy(point);
    return Math.hypot(character.x - p.x, character.y - p.y);
}

// Same map and within range (entities from other maps are not visible anyway).
function isNear(entity, range) {
    return !!entity && (!entity.map || entity.map === character.map) && distanceTo(entity) <= range;
}

module.exports = {
    spawnBoxes: spawnBoxes,
    xy: xy,
    distanceTo: distanceTo,
    isNear: isNear,
};
