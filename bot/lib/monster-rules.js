// =====================================================================
// lib/monster-rules.js - Config rules per monster: boss kinds, Giga Crab rules (foreignOnly, noArea), damage return.
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

// A boss kind (v1.235.8): cooperative, or named in events.policy - the travel magiport and "going ahead to the spot"
// leave those to the boss logic (a split Phoenix search had the mage pull the team to its own empty search area).
function isBossKind(config, name) {
    const def = name && G.monsters[name];
    if (!def) return false;
    return !!def.cooperative || Object.prototype.hasOwnProperty.call(((config.events || {}).policy) || {}, name);
}

// Monsters that return melee damage (porcupines: dreturn 4800 = 48x the damage back) kill
// a melee fighter with its own first hit. Ranged classes are not affected. `m` is a
// monster entity or a G.monsters key; `ctype` defaults to our own class.
function tooSpiky(config, m, ctype) {
    const def = G.monsters[typeof m === "string" ? m : m && m.mtype];
    const mc = (config.targeting && config.targeting.melee) || {};
    if (!def || !(def.dreturn >= (mc.maxDreturn || 100))) return false;
    return (mc.classes || ["warrior", "paladin", "rogue"]).includes(ctype || character.ctype);
}

// Giga Crab rules (events.foreignOnly / events.noArea, 2026-11-23, player decision): monsters we only hit while a
// FOREIGN player holds them (and, when a flag is named, while that flag is not set - crabxx "1hp": it takes 1 damage
// while Huge Crabs live), and monsters no area skill, Taunt, Agitate or Absorb Sins may ever touch.
// events.foreignRules (2026-11-24, player decision): classes that never hit it at all (neverBy - the priest has the
// fewest HP and no way out), and a holder we trust: visible, at least holderMinHp of its HP and within holderMaxDist
// px of the monster - so we never hit just when the holder dies or leaves and the next hit (ours) takes it over.
function foreignOnlyBlocks(config, m) {
    const ev = config.events || {};
    const fo = ev.foreignOnly || {};
    if (!m || !Object.prototype.hasOwnProperty.call(fo, m.mtype)) return false;
    const own = Object.keys(config.characters || {});
    if (!m.target || own.includes(m.target)) return true; // free, or on one of us: never ours to hit
    const flag = fo[m.mtype];
    if (flag && m[flag]) return true;
    const r = (ev.foreignRules || {})[m.mtype] || {};
    if ((r.neverBy || []).includes(character.ctype)) return true;
    if (r.holderMinHp || r.holderMaxDist) {
        const h = (parent.entities || {})[m.target];
        if (!h || h.rip || h.dead) return true; // holder out of sight: no trust
        if (r.holderMinHp && (!h.max_hp || h.hp / h.max_hp < r.holderMinHp)) return true;
        if (r.holderMaxDist && Math.hypot(h.x - m.x, h.y - m.y) > r.holderMaxDist) return true;
    }
    return false;
}
function noArea(config, m) {
    return !!m && ((config.events && config.events.noArea) || []).includes(m.mtype);
}
// A noArea monster within range px of us (or of point p).
// The manual rules (bot_cave: in the cave, or /manual - ours or the leader's) switch area skills off too (v1.231.2).
let noAreaHook = null;
function setNoAreaHook(fn) { noAreaHook = typeof fn === "function" ? fn : null; }
function noAreaNear(config, range, p) {
    // Cave of Many Dreams in manual mode (v1.231.0, player decision 2026-11-24): as if a Giga Crab stood next to us -
    // no Agitate, Cleave or Stomp (they would pull the next pack, the floor keeper or hit travelers and allies).
    // /manual outside the cave the same (v1.231.2, player decision): the player walks, nobody pulls anything.
    if (character.cave && (config.cave || {}).mode === "manual" && (config.cave || {}).noArea !== false) return true;
    try { if (noAreaHook && noAreaHook()) return true; } catch (e) { /* hook only */ }
    const at = p || { x: character.real_x, y: character.real_y };
    return Object.values(parent.entities || {}).some(function (e) {
        return e && e.type === "monster" && !e.dead && noArea(config, e) && Math.hypot(e.x - at.x, e.y - at.y) <= range;
    });
}

module.exports = {
    isBossKind: isBossKind,
    tooSpiky: tooSpiky,
    foreignOnlyBlocks: foreignOnlyBlocks,
    noArea: noArea,
    setNoAreaHook: setNoAreaHook,
    noAreaNear: noAreaNear,
};
