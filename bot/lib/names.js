// =====================================================================
// lib/names.js - Character names without the team prefix (VizWar -> War).
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

// Team name prefixes (v1.233.0): the common start of each team's fighter names ("Viz" for VizPri, VizWar, ...),
// set by deriveTeam. shortName("VizWar") -> "War"; the logs and the status box show names without it.
let teamPrefixes = [];
function shortName(name) {
    const n = String(name || "");
    const p = teamPrefixes.find(function (x) { return n.indexOf(x) === 0 && n.length > x.length; });
    return p ? n.slice(p.length) : n;
}

function setPrefixes(list) { teamPrefixes = list; }
function prefixes() { return teamPrefixes; }

function commonPrefix(names) {
    if (!names.length) return "";
    let p = names[0];
    names.forEach(function (n) { while (p && n.indexOf(p) !== 0) p = p.slice(0, -1); });
    return p;
}

module.exports = {
    shortName: shortName,
    setPrefixes: setPrefixes,
    prefixes: prefixes,
    commonPrefix: commonPrefix,
};
