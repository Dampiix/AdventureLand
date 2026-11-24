// =====================================================================
// lib/items.js - Items: counting, finding, weapon power and burn, two-handers, potion names.
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

function countItem(name) {
    return character.items.reduce(function (sum, item) {
        return item && item.name === name ? sum + (item.q || 1) : sum;
    }, 0);
}

function findItemIndex(predicate) {
    return character.items.findIndex(function (item) { return !!item && predicate(item); });
}

// Potion names for this character: fixed in config, or "auto" by pool size
// (small potions early on, big ones once the pools outgrow them).
function potionNames(p) {
    return {
        hp: p.hp !== "auto" ? p.hp : (character.max_hp >= p.bigFrom.hp ? "hpot1" : "hpot0"),
        mp: p.mp !== "auto" ? p.mp : (character.max_mp >= p.bigFrom.mp ? "mpot1" : "mpot0"),
    };
}

// Attack of a weapon at a level. The game's own formula when the client offers it,
// else the per-level upgrade bonus with the game's multipliers for high levels.
const UPGRADE_MULT = { 7: 1.25, 8: 1.5, 9: 2, 10: 3, 11: 1.25, 12: 1.25 };
function weaponAttack(name, level) {
    try {
        if (typeof calculate_item_properties === "function") {
            const props = calculate_item_properties({ name: name, level: level });
            if (props && typeof props.attack === "number") return props.attack;
        }
    } catch (e) { /* other signature: use our estimate */ }
    const def = G.items[name] || {};
    let attack = def.attack || 0;
    for (let i = 1; i <= level; i++) attack += ((def.upgrade || {}).attack || 0) * (UPGRADE_MULT[i] || 1);
    return attack;
}

// How strong a weapon is in a class's hands: attack with the class's weapon-type
// modifiers (e.g. a paladin deals 5% less with a short sword). 0 = can't wield it.
function weaponPower(name, level, ctype) {
    const def = G.items[name];
    const cls = (G.classes && G.classes[ctype]) || {};
    if (!def || def.type !== "weapon" || (def.class && !def.class.includes(ctype))) return 0;
    const mod = (cls.mainhand || {})[def.wtype] || (cls.doublehand || {})[def.wtype];
    if (!mod) return 0;
    // The priest's attack is its heal, and a heal never procs burn (player decision 2026-11-21).
    return weaponAttack(name, level || 0) * (1 + (mod.output || 0) / 100) * (1 + (mod.frequency || 0) / 100) * (ctype === "priest" ? 1 : burnFactor(name, level || 0));
}
// Burn (Phoenix fire weapons; node/server.js, checked 2026-11-21): a hit procs it with attr0 % chance;
// the target then burns for ~intensity per second for 5 s (a tick of intensity/5 every 210 ms) with
// intensity = that hit's damage - about 4.8x the hit on top, armor ignored. BURN_VALUE takes 80 % of
// that (overlapping procs, targets that die early). Fireblade +7: 5.1 % -> x1.19.
const BURN_VALUE = 3.8;
function burnFactor(name, level) {
    const def = G.items[name];
    if (!def || def.ability !== "burn") return 1;
    let chance = 0;
    try {
        if (typeof calculate_item_properties === "function") chance = (calculate_item_properties({ name: name, level: level }) || {}).attr0 || 0;
    } catch (e) { /* no estimate */ }
    return 1 + chance / 100 * BURN_VALUE;
}

function isDoublehand(name, ctype) {
    const def = G.items[name];
    const cls = (G.classes && G.classes[ctype]) || {};
    return !!(def && (cls.doublehand || {})[def.wtype] && !(cls.mainhand || {})[def.wtype]);
}

module.exports = {
    countItem: countItem,
    findItemIndex: findItemIndex,
    potionNames: potionNames,
    weaponAttack: weaponAttack,
    weaponPower: weaponPower,
    burnFactor: burnFactor,
    isDoublehand: isDoublehand,
};
