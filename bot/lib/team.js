// =====================================================================
// lib/team.js - The team from config.account / leader / team (characters, phases, our mode) and its lowest level.
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

// Fill in the derived fields from config.account / leader / team (2026-11-25, docs/architecture/team-config.md) so the
// rest of the bot keeps reading config.team (leader, fighters, solo, merchant), config.characters, config.phases:
//   config.team.fighters  every account character (may run the bot: trusted, served by the merchant, gear protected)
//   config.team.members   the leader's team; config.team.solo every other account character
//   config.phases.party   party: leader + team (the same for everyone - the merchant reads it), startWithLeader:
//                         team + merchant
//   config.mode           ours: "leader" | "member" (a team member started by the leader - a hidden frame in its
//                         page) | "solo" (every other fighter, also a team member the player started) | "merchant"
//   config.startedByLeader  we run inside the leader's page
function deriveTeam(cfg) {
    const acc = cfg.account || {};
    const fighters = (acc.characters || []).slice();
    const leader = cfg.leader;
    const members = (Array.isArray(cfg.team) ? cfg.team : (cfg.team && cfg.team.members) || []).filter(function (n) { return n !== leader; });
    const merchant = acc.merchant || null;
    const party = [leader].concat(members);
    names.setPrefixes(fighters.length > 1 ? [names.commonPrefix(fighters)].filter(function (p) { return p.length >= 2; }) : []);
    cfg.team = { leader: leader, fighters: fighters, members: members, merchant: merchant, farm: acc.farm || {},
        solo: fighters.filter(function (n) { return !party.includes(n); }) };
    cfg.merchant = merchant;
    cfg.characters = {};
    fighters.forEach(function (name) { cfg.characters[name] = { role: "fighter", farm: (acc.farm || {})[name] || null }; });
    if (merchant) cfg.characters[merchant] = { role: "merchant" };
    cfg.phase = "party";
    cfg.phases = {
        solo: { startWithLeader: merchant ? [merchant] : [], party: [] },
        party: { startWithLeader: members.concat(merchant ? [merchant] : []), party: party },
    };
    // Our mode. A team member counts as started by the leader when the page it runs in is the leader's.
    const me = typeof character !== "undefined" && character ? character.name : null;
    let byLeader = false;
    try { byLeader = !!me && me !== leader && typeof top !== "undefined" && !!top.character && top.character.name === leader; } catch (e) { byLeader = false; }
    cfg.startedByLeader = byLeader;
    cfg.mode = me === merchant ? "merchant" : me === leader ? "leader" : members.includes(me) && byLeader ? "member" : "solo";
    return cfg;
}

module.exports = {
    teamLevel: teamLevel,
    deriveTeam: deriveTeam,
};
