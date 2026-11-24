// =====================================================================
// lib/combat-math.js - Combat math: damage multiplier, learned hit factor, mobbing, fear, kite risk, combat stats.
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

const { distanceTo } = require("./geometry.js");

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
const HIT_KEY = "bot_hit_factor:";
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

// A healer among the players (priest, or anything that reports a heal stat).
function isHealer(p) {
    return !!p && ((p.heal || 0) > 0 || p.ctype === "priest");
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
    damageMultiplier: damageMultiplier,
    hitCfg: hitCfg,
    defenseVs: defenseVs,
    hitMultiplier: hitMultiplier,
    fearMult: fearMult,
    isHealer: isHealer,
    predictedHit: predictedHit,
    noteHitTaken: noteHitTaken,
    hitFactor: hitFactor,
    hitFactors: hitFactors,
    mobCfg: mobCfg,
    mobCap: mobCap,
    mobAt: mobAt,
    mobbing: mobbing,
    mobNow: mobNow,
    combatStats: combatStats,
    kiteRisk: kiteRisk,
    courageOf: courageOf,
    damageTypeOf: damageTypeOf,
    attackersOnMe: attackersOnMe,
    fearRoom: fearRoom,
    wouldScare: wouldScare,
    incomingDamage: incomingDamage,
};
