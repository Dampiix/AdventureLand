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

// The game's status box shows only ~13 characters (player request 2026-11-17): every
// status is shortened here, the details stay in the log. Applied in order.
const SHORT = [
    [/ \([^)]*\)/g, ""],                     // details in brackets
    [/\bDampiixMerch\b/g, "Merch"], [/\bDmpxPriest\b/g, "Pri"], [/\bDmpxRanger\b/g, "Rng"], [/\bDmpx(\w+)/g, "$1"],
    [/ for [A-Z]\w*$/, ""],                     // "... for Pri"
    [/^dead - a priest is reviving me$/, "dead: revive"],
    [/^dead - waiting to respawn$/, "dead: respawn"],
    [/^searching /, "find "],
    [/^waiting for monsters$/, "wait mobs"],
    [/^waiting for a lone /, "lone? "],
    [/^too strong: /, "strong: "],
    [/^moving to /, "> "],
    [/^(warrior|priest|ranger|paladin|rogue|mage): /, "hit "],
    [/^visiting Daisy$/, "Daisy"],
    [/^at Daisy, waiting for .*/, "Daisy: wait"],
    [/^walking to Daisy$/, "> Daisy"],
    [/^following /, "follow "],
    [/^waiting near /, "near "],
    [/^waiting for /, "wait "],
    [/^buying potions$/, "buy pots"],
    [/^going to town$/, "> town"],
    [/^delivering to /, "give "],
    [/^collecting from /, "collect "],
    [/^ready in town$/, "ready"],
    [/^compounding /, "cmp "],
    [/^bank full - not exchanging$/, "bank full!"],
    [/^exchanging /, "exch "],
    [/^upgrading (a )?spare /, "up "],
    [/^upgrading /, "up "],
    [/ towards \+/, ">+"],
    [/ to \+/, " +"],
    [/^(\w+) scroll for /, "$1 "],            // "str scroll for coat1"
    [/^trying /, "try "],
    [/^gear goal: /, ""],                    // just the item (player request 2026-11-17)
    [/^crafting /, "craft "],
    [/^buying /, "buy "],
    [/^checking the bank$/, "check bank"],
    [/^working on /, ""],
    [/^up (\S+) \+(\d+)>\+(\d+)$/, "$1 $2>$3"], // "helmet1 3>7"
    [/ \+(\d)/g, "+$1"],                // "intring+3"
];
function shortStatus(text) {
    return SHORT.reduce(function (t, r) { return t.replace(r[0], r[1]); }, String(text));
}

let lastStatus = "";
function status(text, color) {
    const short = shortStatus(text);
    if (short === lastStatus) return;
    lastStatus = short;
    set_message(short, color || "white");
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
// Walk somewhere with smart_move; a merchant stand is closed first and we wait until the
// server confirms it - with the stand open we crawl at speed 10 (the merchant walked to
// the bank with his stand on, 2026-11-17).
// Opening goes through openStand: a stand that was just asked to open does not show in
// character.stand until the server answers - a walk right after it (the fishing trip
// after keepStand) used to leave with the stand opening on the way (2026-11-17).
let standOpenAt = 0;
function openStand(num) {
    standOpenAt = Date.now();
    const p = typeof open_stand === "function" ? open_stand(num) : parent.open_merchant(num);
    if (p && p.catch) p.catch(function () { /* the next round tries again */ });
    return p;
}
async function walk(dest) {
    while (!character.stand && Date.now() - standOpenAt < 3000) await sleep(100);
    for (let attempt = 0; attempt < 3 && character.stand; attempt++) {
        try {
            const p = typeof close_stand === "function" ? close_stand() : parent.close_merchant();
            if (p && p.catch) p.catch(function () { /* checked below */ });
        } catch (e) { /* checked below */ }
        for (let i = 0; i < 40 && character.stand; i++) await sleep(50);
    }
    return smart_move(dest);
}

// Inside a bank map with its packs loaded. Outside, character.bank is {} (not undefined),
// and right after entering the server sends the packs a moment later. A bank read in
// either state saw no packs, took the bank for empty and full and stopped the exchanges
// ("bank full!", 2026-11-18, walks cut short by a pickup call).
// The Town teleport is channeling (3 s). The server drops every channel on an equip - and a
// potion is drunk through equip (server.js "equip": player.c = {}) - so a potion or a gear swap
// in that time cancels the teleport (player report 2026-11-18).
function townChannel() {
    return !!(character.c && character.c.town);
}

function bankLoaded() {
    return /^bank/.test(character.map) &&
        Object.keys(character.bank || {}).some(function (p) { return /^items\d+$/.test(p); });
}
// Walk into the bank and wait up to 5 s for its packs. False when we did not get in
// (smart_move interrupted by another move): the caller tries again later.
async function walkToBank() {
    try { await walk("bank"); } catch (e) { /* checked below */ }
    for (let i = 0; i < 50 && !bankLoaded() && /^bank/.test(character.map); i++) await sleep(100);
    return bankLoaded();
}

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
    // team.solo: fighters that farm on their own outside the party (served by the merchant
    // like the others, never invited or started by the leader) - e.g. a new character levelling.
    const solo = t.solo || [];
    const grouped = t.fighters.filter(function (n) { return !solo.includes(n); });
    const others = grouped.filter(function (n) { return n !== t.leader; });
    const merchant = cfg.merchant ? [cfg.merchant] : [];
    cfg.phases = {
        solo: { startWithLeader: merchant, party: [] },
        party: { startWithLeader: others.concat(merchant), party: grouped },
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

// Monsters that return melee damage (porcupines: dreturn 4800 = 48x the damage back) kill
// a melee fighter with its own first hit. Ranged classes are not affected. `m` is a
// monster entity or a G.monsters key; `ctype` defaults to our own class.
function tooSpiky(config, m, ctype) {
    const def = G.monsters[typeof m === "string" ? m : m && m.mtype];
    const mc = (config.targeting && config.targeting.melee) || {};
    if (!def || !(def.dreturn >= (mc.maxDreturn || 100))) return false;
    return (mc.classes || ["warrior", "paladin", "rogue"]).includes(ctype || character.ctype);
}

module.exports = {
    tooSpiky: tooSpiky,
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
    walk: walk,
    bankLoaded: bankLoaded,
    townChannel: townChannel,
    walkToBank: walkToBank,
    openStand: openStand,
    isNear: isNear,
    countItem: countItem,
    findItemIndex: findItemIndex,
    isProtected: isProtected,
};
