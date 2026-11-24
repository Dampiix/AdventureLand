// =====================================================================
// lib/team.js - The team from config.team (leader, merchant, phases) and its lowest level.
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

const names = require("./names.js");

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

// Fill in the derived fields (leader, merchant, characters, phases) from
// config.team, so the rest of the bot can keep reading them directly.
function deriveTeam(cfg) {
    // Team name prefixes for shortName/shortStatus: the fighters' common start, at least 2 letters.
    names.setPrefixes([cfg.team].concat(cfg.otherTeams || []).map(function (tm) {
        return tm && tm.fighters && tm.fighters.length > 1 ? names.commonPrefix(tm.fighters) : "";
    }).filter(function (p) { return p.length >= 2; }));
    // Several accounts share this config (2026-11-19: a second account next to the first):
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

module.exports = {
    teamLevel: teamLevel,
    deriveTeam: deriveTeam,
};
