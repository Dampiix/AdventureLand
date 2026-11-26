// cave/cave-doors.js - the stairs between the floors of one Cave of Many Dreams run (v1.238.6, 2026-11-25 second run).
// A cave stair is a door: the client's right click sends a "transport" request, walking onto it does nothing. On the
// second run our members stood on the open stairs of floor 1 while the leader was already on floor 2. These helpers
// find the open door on our map that leads straight to the leader's map - only between this run's floors
// (map "zone_<run>_<floor>"), never the exit: the first run's warrior walked out of the cave and could not come back.

// The open door on myMap that leads to toMap, from the cave state (character.cave.doors: {id, x, y, map, to, down,
// locked}), or null when toMap is not a floor of this run or no such door is open.
function doorTo(state, myMap, toMap) {
    if (!state || !state.run || !Array.isArray(state.doors) || !toMap) return null;
    const floor = "zone_" + state.run + "_";
    if (String(toMap).indexOf(floor) !== 0 || String(myMap).indexOf(floor) !== 0) return null;
    return state.doors.find(function (d) {
        return d && d.map === myMap && d.to === toMap && !d.locked && typeof d.x === "number" && typeof d.y === "number";
    }) || null;
}

// The spawn index the client sends with the door (G.maps[myMap].doors: [x, y, w, h, to, spawn, ...]); 0 if unknown.
function spawnOf(maps, myMap, toMap) {
    const def = maps && maps[myMap];
    const d = def && Array.isArray(def.doors) ? def.doors.find(function (x) { return x && x[4] === toMap; }) : null;
    return d && typeof d[5] === "number" ? d[5] : 0;
}

// Close enough to use the door (the client's is_door_close: within 40 px of the door).
function near(door, x, y, range) {
    return !!door && Math.hypot(door.x - x, door.y - y) < (range || 36);
}

module.exports = { doorTo: doorTo, spawnOf: spawnOf, near: near };
