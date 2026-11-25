// =====================================================================
// monsters/monsters.js - the monster rules: monsters/default.js for every monster, merged with a monsters/<type>.js
// where one exists (only for special cases). Stateless data, so every bundle may carry its own copy.
//   of(type)                  the rules for this monster
//   wholeSpawn(type, pack)    does this spawn entry of G.maps[...].monsters bring the whole spawn at once?
// =====================================================================

const DEFAULT = require("./default.js");
// type -> its special file (e.g. mummy: the module ./mummy.js, required here). None needed today: "auto" reads the rage boxes.
const SPECIAL = {};

function of(type) {
    return Object.assign({}, DEFAULT, SPECIAL[type] || {});
}
function wholeSpawn(type, pack) {
    const w = of(type).wholeSpawn;
    if (w === true || w === false) return w;
    return !!(pack && pack.rage);
}

module.exports = { of: of, wholeSpawn: wholeSpawn };
