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

// Walk straight to an entity when possible, pathfind otherwise.
function moveToEntity(e) {
    const p = xy(e);
    return xmove(p.x, p.y);
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
    xy: xy,
    distanceTo: distanceTo,
    moveToEntity: moveToEntity,
    isNear: isNear,
    countItem: countItem,
    findItemIndex: findItemIndex,
    isProtected: isProtected,
};
