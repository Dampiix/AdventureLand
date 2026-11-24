// =====================================================================
// lib/game.js - Game layer, first part: our own character's HP/MP, skills and weapon (module plan: lib/game.js).
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

function hpRatio() { return character.hp / character.max_hp; }

// MP left after casting a skill now.
function mpLeftAfter(skill) {
    return character.mp - ((G.skills[skill] && G.skills[skill].mp) || 0);
}

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

module.exports = {
    hpRatio: hpRatio,
    mpLeftAfter: mpLeftAfter,
    mpRatio: mpRatio,
    mainhandType: mainhandType,
    canCast: canCast,
};
