// =====================================================================
// bot_util – small stateless helpers shared by all modules.
// =====================================================================

function hpRatio() { return character.hp / character.max_hp; }

// The game's damage multiplier for a defense value (armor or resistance minus the
// attacker's piercing) – same formula as the game's damage_multiplier().
function damageMultiplier(defense) {
    const d = defense;
    const m = 1 - (
        Math.max(0, Math.min(100, d)) * 0.00100 +
        Math.max(0, Math.min(100, d - 100)) * 0.00100 +
        Math.max(0, Math.min(100, d - 200)) * 0.00095 +
        Math.max(0, Math.min(100, d - 300)) * 0.00090 +
        Math.max(0, Math.min(100, d - 400)) * 0.00082 +
        Math.max(0, Math.min(100, d - 500)) * 0.00070 +
        Math.max(0, Math.min(100, d - 600)) * 0.00060 +
        Math.max(0, Math.min(100, d - 700)) * 0.00050 +
        Math.max(0, d - 800) * 0.00040
    ) + Math.max(0, Math.min(50, 0 - d)) * 0.00100 +
        Math.max(0, Math.min(50, -50 - d)) * 0.00075 +
        Math.max(0, Math.min(50, -100 - d)) * 0.00050 +
        Math.max(0, -150 - d) * 0.00025;
    return Math.min(1.32, Math.max(0.05, m));
}

// Our combat stats, as the leader's boss check needs them.
function combatStats() {
    const c = character;
    return {
        name: c.name, ctype: c.ctype, level: c.level, max_hp: c.max_hp,
        attack: c.attack || 0, heal: c.heal || 0, frequency: c.frequency || 1,
        armor: c.armor || 0, resistance: c.resistance || 0,
        apiercing: c.apiercing || 0, rpiercing: c.rpiercing || 0,
        damage_type: c.damage_type || ((G.classes && G.classes[c.ctype]) || {}).damage_type || "physical",
    };
}

// Lowest level among us and the party's fighters (from get_party()).
function teamLevel(config) {
    let level = character.level;
    const p = get_party() || {};
    Object.keys(p).forEach(function (name) {
        if (config.characters[name] && config.characters[name].role === "fighter" && p[name] && p[name].level) {
            level = Math.min(level, p[name].level);
        }
    });
    return level;
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

// Fill in the derived fields (leader, merchant, characters, phases) from
// config.team, so the rest of the bot can keep reading them directly.
function deriveTeam(cfg) {
    const t = cfg.team;
    cfg.leader = t.leader;
    cfg.merchant = t.merchant || null;
    cfg.characters = {};
    t.fighters.forEach(function (name) {
        cfg.characters[name] = { role: "fighter", farm: (t.farm || {})[name] || null };
    });
    if (cfg.merchant) cfg.characters[cfg.merchant] = { role: "merchant" };
    const others = t.fighters.filter(function (n) { return n !== t.leader; });
    const merchant = cfg.merchant ? [cfg.merchant] : [];
    cfg.phases = {
        solo: { startWithLeader: merchant, party: [] },
        party: { startWithLeader: others.concat(merchant), party: t.fighters.slice() },
    };
    return cfg;
}

// Potion names for this character: fixed in config, or "auto" by pool size
// (small potions early on, big ones once the pools outgrow them).
function potionNames(p) {
    return {
        hp: p.hp !== "auto" ? p.hp : (character.max_hp >= p.bigFrom.hp ? "hpot1" : "hpot0"),
        mp: p.mp !== "auto" ? p.mp : (character.max_mp >= p.bigFrom.mp ? "mpot1" : "mpot0"),
    };
}

// Gold amount from a config value: a number, or { ratio, min, max } of our gold,
// or { perLevel, min, max } of our level.
function goldAmount(spec) {
    if (typeof spec === "number") return spec;
    const base = spec.perLevel !== undefined ? character.level * spec.perLevel : character.gold * (spec.ratio || 0);
    return Math.max(spec.min || 0, Math.min(spec.max !== undefined ? spec.max : Infinity, Math.floor(base)));
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
    return weaponAttack(name, level || 0) * (1 + (mod.output || 0) / 100) * (1 + (mod.frequency || 0) / 100);
}

function isDoublehand(name, ctype) {
    const def = G.items[name];
    const cls = (G.classes && G.classes[ctype]) || {};
    return !!(def && (cls.doublehand || {})[def.wtype] && !(cls.mainhand || {})[def.wtype]);
}

// Seconds per kill for the whole team on one of the guide's routes. The guide plans
// for the leader alone: `seconds` is its kill time, `cycle` adds waiting for
// respawns. The team kills `speedup` times as fast, but never faster than the spot
// respawns. null without a usable route.
function teamCycle(route, speedup) {
    if (!route || !(route.cycle > 0)) return null;
    const kill = (route.seconds > 0 ? route.seconds : route.cycle) + 1.5;
    const spawn = route.cycle > kill + 0.01 ? route.cycle : 0; // spot limited by respawns
    return Math.max(kill / (speedup || 1), spawn);
}

module.exports = {
    teamCycle: teamCycle,
    deriveTeam: deriveTeam,
    weaponPower: weaponPower,
    isDoublehand: isDoublehand,
    potionNames: potionNames,
    goldAmount: goldAmount,
    hpRatio: hpRatio,
    teamLevel: teamLevel,
    damageMultiplier: damageMultiplier,
    combatStats: combatStats,
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
