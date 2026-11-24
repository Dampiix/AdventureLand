// =====================================================================
// lib/game.js - the game layer (module plan): the only place a module should touch the game. This is the browser
// version (Steam / web client); a headless client later implements the same names.
// First part (pilot steps 2-3): our own character's HP/MP, skills and weapon (from util.js), plus thin wrappers for
// what the mage's skill modules need. No logic here - every function is a plain call into the client.
// Stateless, so a bundle may carry its own copy.
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

// ---- wrappers (pilot step 3) -------------------------------------------------------------------------------
function me() { return character; }                                   // our character
function data() { return G; }                                         // the game data
function entities() { return parent.entities || {}; }                 // everything in sight, by id
function player(name) { return get_player(name); }                    // a player in sight, or null
function partyInfo() { return get_party() || {}; }                    // party members (lagging positions)
function targetedMonster() { return get_targeted_monster(); }
function nearestMonster(filter) { return get_nearest_monster(filter); }
function inRange(entity, skill) { return is_in_range(entity, skill); }
function onCooldown(skill) { return is_on_cooldown(skill); }
function useSkill(name, target, extra) { return use_skill(name, target, extra); }
function nextAttackAt() { return parent.next_skill && parent.next_skill.attack; } // Date of our next attack, or undefined
function itemProps(item) { return parent.calculate_item_properties(item); }       // throws in some clients
function changeTarget(target) { return change_target(target); }
function canAttack(target) { return can_attack(target); }
function attackTarget(target) { return attack(target); }            // named apart: "attack" is the client's
function unequipSlot(slot) { return unequip(slot); }
function path() { return typeof smart !== "undefined" ? smart : null; } // the running smart_move (plan in .plot)
function canMoveTo(x, y) { return can_move_to(x, y); }
function transporting(entity) { return typeof is_transporting === "function" && is_transporting(entity); }
function isMoving(entity) { return is_moving(entity); }                 // stage 2 (priest)
function storageGet(key) { return get(key); }                         // shared storage (all our windows); may throw
function moveTo(x, y) { return xmove(x, y); }                         // stage 2 (rogue): walk, path search if needed
function stopAction(what) { return stop(what); }                      // e.g. stop("invis")
function storageSet(key, value) { return set(key, value); }           // stage 2 (warrior); may throw
function entityDistance(a, b) { return parent.distance(a, b); }        // hitbox edge to edge; throws in some clients
function walkStraight(x, y) { return move(x, y); }                    // a straight move (no path search)

module.exports = {
    hpRatio: hpRatio,
    mpLeftAfter: mpLeftAfter,
    mpRatio: mpRatio,
    mainhandType: mainhandType,
    canCast: canCast,
    me: me,
    data: data,
    entities: entities,
    player: player,
    partyInfo: partyInfo,
    targetedMonster: targetedMonster,
    nearestMonster: nearestMonster,
    inRange: inRange,
    onCooldown: onCooldown,
    useSkill: useSkill,
    nextAttackAt: nextAttackAt,
    itemProps: itemProps,
    changeTarget: changeTarget,
    canAttack: canAttack,
    attackTarget: attackTarget,
    unequipSlot: unequipSlot,
    path: path,
    canMoveTo: canMoveTo,
    transporting: transporting,
    isMoving: isMoving,
    storageGet: storageGet,
    moveTo: moveTo,
    stopAction: stopAction,
    storageSet: storageSet,
    entityDistance: entityDistance,
    walkStraight: walkStraight,
};
