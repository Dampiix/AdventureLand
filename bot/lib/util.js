// =====================================================================
// bot_util – small helpers shared by all modules. Most are stateless; some keep
// module state: hit factors, mobbing combo, journal buffer, status line, stand
// opening, heartbeat.
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

// ---- learned hit factor (2026-11-22) -------------------------------------------------
// The safety checks predict a monster's hit as attack x damageMultiplier(our defense - its
// piercing). The warrior died to Agitated iceroamers that hit for 337-365 where that formula says
// ~150 - the checks called four of them safe. So every hit we take is compared with the formula:
// per monster kind the sum of real damage and of predicted damage (stored per character, all
// fighters' data combined). From hitFactor.minHits hits on, hitFactor() is real / predicted,
// never below 1 (the checks only get more careful) and at most hitFactor.max. Old hits fade:
// above hitFactor.keepHits the sums are halved.
const HIT_KEY = "dmpx_hit_factor:";
let hitOwn = null, hitSavedAt = 0, hitAll = null, hitAllAt = 0;
function hitCfg() {
    const c = typeof BOT_CONFIG !== "undefined" && BOT_CONFIG ? BOT_CONFIG : {};
    return (c.targeting && c.targeting.hitFactor) || {};
}
// The defense that counts when `attacker` hits `target` with damage `type` (codebase review 2026-11-22: written out
// about 15 times, and the copies drifted - pure damage was reduced by resistance in some). Physical: armor minus
// the attacker's armor piercing; magical: resistance minus resistance piercing; pure: none. Unknown types count
// as physical. target / attacker: an entity, a stats object or a G.monsters entry.
function defenseVs(target, type, attacker) {
    const a = attacker || {};
    if (type === "pure") return 0;
    if (type === "magical") return ((target && target.resistance) || 0) - (a.rpiercing || 0);
    return ((target && target.armor) || 0) - (a.apiercing || 0);
}
// The damage multiplier of that hit (server formula).
function hitMultiplier(target, type, attacker) {
    return damageMultiplier(defenseVs(target, type, attacker));
}
// Fear (server.js): attackers over our courage for one damage type cut our attack to 60 / 40 / 20 %.
function fearMult(over) {
    return over > 2 ? 0.2 : over > 1 ? 0.4 : over > 0 ? 0.6 : 1;
}
// A promise whose rejection is not interesting (an interrupted move): no "Uncaught (in promise)" log spam.
function quiet(p) {
    if (p && typeof p.catch === "function") p.catch(function () {});
    return p;
}
// A healer among the players (priest, or anything that reports a heal stat).
function isHealer(p) {
    return !!p && ((p.heal || 0) > 0 || p.ctype === "priest");
}
// The spawn boxes [x1, y1, x2, y2] of a map's monster pack (map.monsters entry) on that map.
function spawnBoxes(pack, mapName) {
    if (!pack) return [];
    if (pack.boundaries) return pack.boundaries.filter(function (b) { return !mapName || b[0] === mapName; }).map(function (b) { return b.slice(1); });
    return pack.boundary ? [pack.boundary] : [];
}
// MP left after casting a skill now.
function mpLeftAfter(skill) {
    return character.mp - ((G.skills[skill] && G.skills[skill].mp) || 0);
}
function predictedHit(attacker, me) {
    const def = G.monsters[attacker.mtype] || {};
    const type = attacker.damage_type || def.damage_type || "physical";
    const pierce = { apiercing: attacker.apiercing != null ? attacker.apiercing : (def.apiercing || 0),
        rpiercing: attacker.rpiercing != null ? attacker.rpiercing : (def.rpiercing || 0) };
    return (attacker.attack || def.attack || 0) * hitMultiplier(me, type, pierce);
}
// A "hit" event on us: d.damage from d.hid (attacker entity, if we see it).
// Mobbed hits (d.mobbing, see mobbingMult) carry the server's combo: noted for the live check, not
// learned - the mobbing model covers them, and they made the bat factor 3.2 (2026-11-22).
function noteHitTaken(d, attacker) {
    if (d && d.mobbing > 0 && d.damage > 0) { mobState.combo = d.mobbing; mobState.at = Date.now(); }
    const hc = hitCfg();
    if (hc.enabled === false || !d || !(d.damage > 0) || !attacker || attacker.type !== "monster") return;
    if (d.heal || d.dreturn || d.reflect || d.mobbing) return;
    const exp = predictedHit(attacker, character);
    if (!(exp > 0)) return;
    if (!hitOwn) { try { hitOwn = get(HIT_KEY + character.name) || {}; } catch (e) { hitOwn = {}; } }
    const r = hitOwn[attacker.mtype] || (hitOwn[attacker.mtype] = { dmg: 0, exp: 0, n: 0 });
    r.dmg += d.damage; r.exp += exp; r.n++; r.at = Date.now();
    if (r.n > (hc.keepHits || 400)) { r.dmg /= 2; r.exp /= 2; r.n = Math.round(r.n / 2); }
    if (Date.now() - hitSavedAt > 30 * 1000) {
        hitSavedAt = Date.now();
        try { set(HIT_KEY + character.name, hitOwn); } catch (e) { /* storage unavailable */ }
        hitAllAt = 0;
    }
}
// Real / predicted damage per hit for this monster kind over every fighter's hits, or 1.
function hitFactor(mtype) {
    const hc = hitCfg();
    if (hc.enabled === false || !mtype) return 1;
    if (!hitAll || Date.now() - hitAllAt > 60 * 1000) {
        hitAllAt = Date.now();
        hitAll = {};
        const c = typeof BOT_CONFIG !== "undefined" && BOT_CONFIG ? BOT_CONFIG : {};
        const names = ((c.team && c.team.fighters) || []).slice();
        if (!names.includes(character.name)) names.push(character.name);
        names.forEach(function (n) {
            let data = null;
            if (n === character.name && hitOwn) data = hitOwn;
            else { try { data = get(HIT_KEY + n); } catch (e) { data = null; } }
            Object.keys(data || {}).forEach(function (m) {
                const s = hitAll[m] || (hitAll[m] = { dmg: 0, exp: 0, n: 0 });
                s.dmg += data[m].dmg || 0; s.exp += data[m].exp || 0; s.n += data[m].n || 0;
            });
        });
    }
    const s = hitAll[mtype];
    if (!s || s.n < (hc.minHits || 20) || !(s.exp > 0)) return 1;
    return Math.min(hc.max || 5, Math.max(1, s.dmg / s.exp));
}
// Every kind with enough hits, for "/safety hits": [type, factor, hits].
function hitFactors() {
    hitFactor("__refresh__");
    return Object.keys(hitAll || {}).map(function (m) {
        const s = hitAll[m];
        return [m, s.exp > 0 ? s.dmg / s.exp : 0, s.n];
    }).sort(function (a, b) { return b[1] - a[1]; });
}

// ---- mobbing (2026-11-22, server.js commence_attack) ---------------------------------
// With more than 3 monsters targeting a player (any distance - the count goes up when a monster
// takes the player as its target), every hit on that player raises a combo counter (reset after 5 s
// without such a hit) and is multiplied:
//   combo 2..10: 1.62 1.64 1.7 1.72 1.75 1.8 1.9 2 2 ; above 10: combo / 4
//   at most max(300 / attack, 1.2)  - attack = the monster's raw attack
// So in a mob every hit counts like ~300 raw attack at least: 4 agitated level-1 iceroamers (120)
// hit 2.5x, level-18 bats (80) up to 3.75x, goos (6) went from 8 to 76 per hit in 18 s (test).
// The combo grows only by hits that land, so monsters still on their way don't speed it up.
// The server's table, indexed by the combo it reports as "mobbing" (the first mobbed hit is 2).
const MOB_TABLE = [1, 1.6, 1.62, 1.64, 1.7, 1.72, 1.75, 1.8, 1.9, 2, 2, 2, 2];
const mobState = { combo: 0, at: 0 }; // last combo the server sent us (noteHitTaken)
function mobCfg() {
    const c = typeof BOT_CONFIG !== "undefined" && BOT_CONFIG ? BOT_CONFIG : {};
    return (c.targeting && c.targeting.mobbing) || {};
}
function mobCap(attack) { return Math.max(300 / Math.max(1, attack || 1), 1.2); }
function mobAt(combo, attack) {
    if (combo < 2) return 1;
    return Math.min(combo > 10 ? combo / 4 : MOB_TABLE[combo], mobCap(attack));
}
// Average and peak multiplier over a fight: `targets` monsters target the player (the trigger),
// `hitsPerSec` hits land per second (those standing on him), for `seconds`. { avg, peak }
function mobbing(attack, targets, hitsPerSec, seconds) {
    if (mobCfg().enabled === false || !(targets > 3)) return { avg: 1, peak: 1 };
    const total = Math.max(1, Math.round((hitsPerSec || 0) * (seconds || 0)));
    const cap = mobCap(attack);
    let sum = 0, peak = 1, i = 0;
    for (; i < total; i++) {
        const m = mobAt(i + 2, attack); // the first mobbed hit has combo 2
        sum += m; peak = m;
        if (m >= cap) { sum += cap * (total - i - 1); break; }
    }
    return { avg: sum / total, peak: peak };
}
// The live combo (0 when the last mobbed hit is older than 5 s) and its multiplier for `attack`.
function mobNow(attack) {
    const combo = Date.now() - mobState.at < 5000 ? mobState.combo : 0;
    return { combo: combo, mult: combo ? mobAt(combo + 1, attack) : 1 };
}

// Our combat stats, as the leader's boss check needs them.
function combatStats() {
    const c = character;
    return {
        name: c.name, ctype: c.ctype, level: c.level, max_hp: c.max_hp,
        attack: c.attack || 0, heal: c.heal || 0, frequency: c.frequency || 1,
        armor: c.armor || 0, resistance: c.resistance || 0,
        apiercing: c.apiercing || 0, rpiercing: c.rpiercing || 0,
        range: c.range || 0, speed: c.speed || 0, // kiting in the boss check (2026-11-21)
        courage: c.courage, mcourage: c.mcourage, pcourage: c.pcourage, // fear in the team model (2026-11-22)
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
    [/^dead - a priest is reviving me$/, "dead: revive"],
    [/^dead - waiting to respawn$/, "dead: respawn"],
    [/^searching /, "? "],                // "? booboo" (player request 2026-11-18)
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
    // "... for Pri" - after the waiting rules: first, it cut "waiting for VizWar" down to
    // "waiting" and the leader's team wait showed no name (2026-11-20).
    [/ for [A-Z]\w*$/, ""],
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
    if (JOURNAL_TAGS.includes(tag)) journal("[" + tag + "] " + text);
}

// Decision journal (player request 2026-11-21): why and when the team changes its spot. The
// game log keeps ~200 lines without times; this keeps the last 400 decisions with a timestamp
// per character in the storage ("dmpx_journal:<name>": [[ms, text], ...]).
// "dps" (2026-11-21): the damage meter's 5-minute lines (team damage/s, kills) for the measurement hours.
const JOURNAL_TAGS = ["target", "drops", "hunt", "event", "party", "cavalry", "dps", "kills", "scout"];
let journalBuf = null;
function journal(text) {
    try {
        const key = "dmpx_journal:" + character.name;
        if (!journalBuf) journalBuf = get(key) || [];
        journalBuf.push([Date.now(), text]);
        if (journalBuf.length > 400) journalBuf.splice(0, journalBuf.length - 400);
        set(key, journalBuf);
    } catch (e) { /* storage unavailable */ }
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
// Walk somewhere with smart_move; a merchant stand is closed first and we wait until the
// server confirms it - with the stand open we crawl at speed 10 (the merchant walked to
// the bank with his stand on, 2026-11-17).
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

// The Town teleport is channeling (3 s). The server drops every channel on an equip - and a
// potion is drunk through equip (server.js "equip": player.c = {}) - so a potion or a gear swap
// in that time cancels the teleport (player report 2026-11-18).
function townChannel() {
    return !!(character.c && character.c.town);
}

// Inside a bank map with its packs loaded. Outside, character.bank is {} (not undefined),
// and right after entering the server sends the packs a moment later. A bank read in
// either state saw no packs, took the bank for empty and full and stopped the exchanges
// ("bank full!", 2026-11-18, walks cut short by a pickup call).
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

// Fill in the derived fields (leader, merchant, characters, phases) from
// config.team, so the rest of the bot can keep reading them directly.
function deriveTeam(cfg) {
    // Several accounts share this config (2026-11-19: the fresh account "Viz" next to "Dmpx"):
    // the team that lists the running character is used; cfg.team stays the default.
    const me = typeof character !== "undefined" && character ? character.name : null;
    const inTeam = function (t) { return t && me && ((t.fighters || []).includes(me) || t.merchant === me); };
    if (me && !inTeam(cfg.team)) {
        const other = (cfg.otherTeams || []).find(inTeam);
        if (other) cfg.team = other;
    }
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

// Waypoint before a smart_move (config.travel.via, 2026-11-21): { spookytown: "halloween" } - a map
// reached through a dangerous one is walked to via a safe map (the Vampire Rats in level1 killed the
// ranger twice on its way to Spooky Town). Resolves at once when no waypoint applies.
function viaFirst(dest) {
    const cfg = typeof BOT_CONFIG !== "undefined" && BOT_CONFIG ? BOT_CONFIG : {};
    const via = (cfg.travel && cfg.travel.via) || {};
    const map = dest && typeof dest === "object" ? dest.map : null;
    const v = map && via[map];
    if (!v || character.map === map || character.map === v) return Promise.resolve();
    return smart_move({ map: v });
}

// Kiting in the farm checks (player decision 2026-11-21): a monster we can keep at bay - its sprint
// (charge, scaled by how much faster this grown one is) below combat.kite.farmSpeedRatio of our speed,
// its range + farmRangeMargin below ours, no special abilities - still hits now and then: its damage
// counts with combat.kite.farmRisk (a residual risk, never 0). Returns that factor, or 1.
// me: { speed, range } (our character or a member's stats).
function kiteRisk(def, live, me) {
    const cfg = typeof BOT_CONFIG !== "undefined" && BOT_CONFIG ? BOT_CONFIG : {};
    const k = (cfg.combat && cfg.combat.kite) || {};
    if (!k.enabled || !k.farmRisk || !def || !me || !me.speed || !me.range) return 1;
    if (def.abilities && Object.keys(def.abilities).length) return 1;
    const grow = live && live.speed && def.speed ? Math.max(1, live.speed / def.speed) : 1;
    const sprint = (def.charge || def.speed || 0) * grow;
    const reach = (live && live.range) || def.range || 0;
    if (sprint >= me.speed * (k.farmSpeedRatio || 0.9)) return 1;
    if (reach + (k.farmRangeMargin || 50) >= me.range) return 1;
    return k.farmRisk;
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

// Giga Crab rules (events.foreignOnly / events.noArea, 2026-11-23, player decision): monsters we only hit while a
// FOREIGN player holds them (and, when a flag is named, while that flag is not set - crabxx "1hp": it takes 1 damage
// while Huge Crabs live), and monsters no area skill, Taunt, Agitate or Absorb Sins may ever touch.
function foreignOnlyBlocks(config, m) {
    const fo = (config.events && config.events.foreignOnly) || {};
    if (!m || !Object.prototype.hasOwnProperty.call(fo, m.mtype)) return false;
    const own = Object.keys(config.characters || {});
    if (!m.target || own.includes(m.target)) return true; // free, or on one of us: never ours to hit
    const flag = fo[m.mtype];
    return !!(flag && m[flag]);
}
function noArea(config, m) {
    return !!m && ((config.events && config.events.noArea) || []).includes(m.mtype);
}
// A noArea monster within range px of us (or of point p).
function noAreaNear(config, range, p) {
    const at = p || { x: character.real_x, y: character.real_y };
    return Object.values(parent.entities || {}).some(function (e) {
        return e && e.type === "monster" && !e.dead && noArea(config, e) && Math.hypot(e.x - at.x, e.y - at.y) <= range;
    });
}

// Heartbeat for the member watchdog (main.js, player decision 2026-11-20): every 10 s after a
// loop step went through, "dmpx_beat:<name>" = { at, server } in the storage all our windows
// share. A loop that stops or throws every step stops the beat.
let lastBeatAt = 0;
function heartbeat() {
    const now = Date.now();
    if (now - lastBeatAt < 10000) return;
    lastBeatAt = now;
    try {
        const server = typeof parent !== "undefined" && parent.server_region ? parent.server_region + " " + parent.server_identifier : null;
        // hp: for the priest's Party Heal on members out of its sight (2026-11-21).
        set("dmpx_beat:" + character.name, { at: now, server: server, hp: character.max_hp ? Math.round(character.hp / character.max_hp * 100) / 100 : 1, rip: !!character.rip });
    } catch (e) { /* storage unavailable */ }
}

// The team's home server, e.g. "EU IV" (player request 2026-11-21: not hard-coded - the team was
// moved to another server by hand and the merchant would have hopped straight back to EU III):
// where the leader runs, from its last heartbeat (any age - a leader restart must not send the
// merchant to the configured server), else merchantRole.pontyRound.home.
function teamServer(config) {
    try {
        const b = get("dmpx_beat:" + config.leader);
        if (b && b.server) return b.server;
    } catch (e) { /* storage unavailable */ }
    const pr = (config.merchantRole && config.merchantRole.pontyRound) || {};
    return (pr.home || ["EU", "III"]).join(" ");
}

// ---- fear and incoming damage (after earthiverse's attack.ts / avoid_death.ts, player decision
// 2026-11-21) ----------------------------------------------------------------------------------
// Fear (server): more attackers of one damage type than our courage for it (courage, mcourage,
// pcourage) cut our attack to 60/40/20 %.
function courageOf(type) {
    const c = type === "pure" ? character.pcourage : type === "magical" ? character.mcourage : character.courage;
    return typeof c === "number" ? c : Infinity;
}
function damageTypeOf(e) {
    return ((G.monsters[e.mtype] || {}).damage_type) || "physical";
}
function attackersOnMe() {
    return Object.values(parent.entities || {}).filter(function (e) {
        return e && e.type === "monster" && !e.dead && e.target === character.name;
    });
}
// How many more attackers of this damage type we can take before fear sets in.
function fearRoom(type, extra) {
    const n = attackersOnMe().filter(function (e) { return damageTypeOf(e) === type; }).length + (extra || 0);
    return courageOf(type) - n;
}
// A free monster we are about to pull would scare us (no room left for its damage type).
function wouldScare(e) {
    return !!e && !e.target && fearRoom(damageTypeOf(e)) <= 0;
}
// The damage the attackers on us can deal in their next hit: each one within its range + speed
// hits for its maximum, times (1 + 0.2 per attacker of its type beyond our courage). onlyType:
// count only that damage type (Hard Shell: physical).
function incomingDamage(onlyType) {
    const near = attackersOnMe().filter(function (e) {
        const d = G.monsters[e.mtype] || {};
        const reach = (e.range || d.range || 20) + (e.speed || d.speed || 0);
        return distanceTo(e) <= reach;
    });
    const count = {};
    near.forEach(function (e) { const t = damageTypeOf(e); count[t] = (count[t] || 0) + 1; });
    return near.reduce(function (sum, e) {
        const t = damageTypeOf(e);
        if (onlyType && t !== onlyType) return sum;
        const d = G.monsters[e.mtype] || {};
        const def = t === "physical" ? (character.armor || 0) - (d.apiercing || 0)
            : t === "magical" ? (character.resistance || 0) - (d.rpiercing || 0) : 0;
        const hit = (e.attack || d.attack || 0) * 1.1 * (t === "pure" ? 1 : damageMultiplier(def));
        return sum + hit * (1 + 0.2 * Math.max(0, count[t] - courageOf(t)));
    }, 0);
}

module.exports = {
    courageOf: courageOf,
    fearRoom: fearRoom,
    wouldScare: wouldScare,
    incomingDamage: incomingDamage,
    damageTypeOf: damageTypeOf,
    teamServer: teamServer,
    heartbeat: heartbeat,
    journal: journal,
    tooSpiky: tooSpiky,
    foreignOnlyBlocks: foreignOnlyBlocks,
    noArea: noArea,
    noAreaNear: noAreaNear,
    teamCycle: teamCycle,
    deriveTeam: deriveTeam,
    weaponPower: weaponPower,
    viaFirst: viaFirst,
    kiteRisk: kiteRisk,
    isDoublehand: isDoublehand,
    potionNames: potionNames,
    goldAmount: goldAmount,
    hpRatio: hpRatio,
    teamLevel: teamLevel,
    damageMultiplier: damageMultiplier,
    defenseVs: defenseVs,
    hitMultiplier: hitMultiplier,
    fearMult: fearMult,
    quiet: quiet,
    isHealer: isHealer,
    spawnBoxes: spawnBoxes,
    mpLeftAfter: mpLeftAfter,
    attackersOnMe: attackersOnMe,
    noteHitTaken: noteHitTaken,
    mobbing: mobbing,
    mobCap: mobCap,
    mobNow: mobNow,
    predictedHit: predictedHit,
    hitFactor: hitFactor,
    hitFactors: hitFactors,
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
};
