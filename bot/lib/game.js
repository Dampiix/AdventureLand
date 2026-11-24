// =====================================================================
// lib/game.js - the game layer (module plan): the only place a module should touch the game. This is the browser
// version (Steam / web client); a headless client later implements the same names.
// Our own character's HP/MP, skills and weapon, thin wrappers around client calls (pilot steps 2-3, stages 2-3b), plus
// the page-level helpers: hook (wrap a client function once), onSocket (one socket listener per key), teamRegistry and
// serverName (team view). No game logic here. It keeps no state of its own - what it keeps lives on the page or window
// (named keys, safe across reloads) - so a bundle may carry its own copy.
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
function smartMove(dest) { return smart_move(dest); }                 // stage 3b (travel): a path walk (a promise)
function serverName() { return parent.server_region + " " + parent.server_identifier; } // e.g. "EU IV" (team view)

// The team registry (team view, step 0): one object per client on the game page, reached by every CODE frame of this
// client (the main character's and the #iframelist characters'). Headless: one object per process instead.
function teamRegistry() {
    const T = top;
    if (!T.__botTeam) T.__botTeam = {};
    return T.__botTeam;
}

// A listener on the game page's socket (stage 5): it lives on the page and outlasts a code reload, so it is kept there as
// parent.__bot<Key>Fn and the previous one with the same key is taken off first - a reload never stacks them. Throws
// without a socket (callers catch).
function onSocket(event, key, fn) {
    const PAGE = parent;
    const name = "__bot" + key + "Fn";
    if (PAGE[name]) PAGE.socket.off(event, PAGE[name]);
    PAGE[name] = fn;
    PAGE.socket.on(event, fn);
}

// Wraps a client function of this frame (stage 3b, the rage walls): make(original) returns the replacement. The
// original is kept on the window as __botOrig<Name> (can_move -> __botOrigCanMove), so a second install wraps the
// original again, never our own wrapper. once: a function wrapped before stays as it is. False when nothing was wrapped.
function hook(name, make, once) {
    const W = window;
    const key = "__botOrig" + name.split("_").map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); }).join("");
    if (once && W[key]) return false;
    if (!W[key]) W[key] = W[name];
    const orig = W[key];
    if (typeof orig !== "function") return false;
    W[name] = make(orig);
    return true;
}

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
    smartMove: smartMove,
    serverName: serverName,
    hook: hook,
    onSocket: onSocket,
    teamRegistry: teamRegistry,
};
