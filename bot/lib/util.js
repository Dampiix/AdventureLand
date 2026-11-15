// =====================================================================
// bot_util – small stateless helpers shared by all modules.
// =====================================================================

function hpRatio() { return character.hp / character.max_hp; }
function mpRatio() { return character.mp / character.max_mp; }

// Weapon type of the equipped mainhand, or null.
function mainhandType() {
    const item = character.slots.mainhand;
    const def = item && G.items[item.name];
    return (def && def.wtype) || null;
}

// Skill is learned, usable with the current weapon, affordable and off cooldown.
function canCast(skill) {
    const def = G.skills[skill];
    if (!def) return false;
    if (def.level && character.level < def.level) return false;
    if (def.wtype && ![].concat(def.wtype).includes(mainhandType())) return false; // e.g. Smash needs a mace
    if (def.mp && character.mp < def.mp) return false;
    return !is_on_cooldown(skill);
}

function errReason(e) {
    return (e && (e.reason || e.message)) || String(e);
}

let lastStatus = "";
function status(text, color) {
    if (text === lastStatus) return;
    lastStatus = text;
    set_message(text, color || "white");
}

function log(tag, text, color) {
    game_log("[" + tag + "] " + text, color || "white");
}

function distanceTo(point) {
    const x = point.real_x !== undefined ? point.real_x : point.x;
    const y = point.real_y !== undefined ? point.real_y : point.y;
    return Math.hypot(character.real_x - x, character.real_y - y);
}

// Same map and within range (entities from other maps are not visible anyway).
function isNear(entity, range) {
    return !!entity && (!entity.map || entity.map === character.map) && distanceTo(entity) <= range;
}

function countItem(name) {
    return character.items.reduce(function (sum, item) {
        return item && item.name === name ? sum + (item.q || 1) : sum;
    }, 0);
}

function findItemIndex(predicate) {
    return character.items.findIndex(function (item) { return !!item && predicate(item); });
}

// Upgraded, shiny or locked items are treated as valuable.
function isProtected(item) {
    return (item.level || 0) > 0 || !!item.p || !!item.l;
}

module.exports = {
    hpRatio: hpRatio,
    mpRatio: mpRatio,
    canCast: canCast,
    mainhandType: mainhandType,
    errReason: errReason,
    status: status,
    log: log,
    distanceTo: distanceTo,
    isNear: isNear,
    countItem: countItem,
    findItemIndex: findItemIndex,
    isProtected: isProtected,
};
