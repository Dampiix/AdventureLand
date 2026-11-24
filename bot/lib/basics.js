// =====================================================================
// lib/basics.js - Small helpers without game state: error reasons, quiet promises, gold amounts, team kill cycle.
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

// A promise whose rejection is not interesting (an interrupted move): no "Uncaught (in promise)" log spam.
function quiet(p) {
    if (p && typeof p.catch === "function") p.catch(function () {});
    return p;
}

function errReason(e) {
    return (e && (e.reason || e.message)) || String(e);
}

// Gold amount from a config value: a number, or { ratio, min, max } of our gold,
// or { perLevel, min, max } of our level.
function goldAmount(spec) {
    if (typeof spec === "number") return spec;
    const base = spec.perLevel !== undefined ? character.level * spec.perLevel : character.gold * (spec.ratio || 0);
    return Math.max(spec.min || 0, Math.min(spec.max !== undefined ? spec.max : Infinity, Math.floor(base)));
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
    quiet: quiet,
    errReason: errReason,
    goldAmount: goldAmount,
    teamCycle: teamCycle,
};
