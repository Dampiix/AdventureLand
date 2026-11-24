// =====================================================================
// bot_team_stats - every fighter's combat stats for the team model (module plan, stage 4a; moved out of
// core/events.js unchanged). One instance per bot (main.js), used by events (boss check) and targeting (team model).
//   shareStats()  every 60 s our stats to every other team fighter in the party (comms "stats")
//   teamStats()   our stats + the fresh reports (3 min) of the fighters in our party
//   reports       the raw reports by name ({ s, at })
// The reports survive a restart (storage "bot_team_stats:<name>"): copies up to 30 min old count as fresh at the start,
// else the boss check waited up to a minute for "the team's stats".
// deps: { config, util, comms, party } - party may be a getter.
// =====================================================================

module.exports = function createTeamStats(deps) {
    const config = deps.config, util = deps.util, comms = deps.comms;

    const STATS_KEY = "bot_team_stats:" + character.name;
    const stats = (function () {
        const out = {};
        try {
            const saved = get(STATS_KEY) || {};
            Object.keys(saved).forEach(function (n) {
                if (saved[n] && saved[n].s && Date.now() - saved[n].at < 30 * 60 * 1000) out[n] = { s: saved[n].s, at: Date.now() };
            });
        } catch (e) { /* storage unavailable */ }
        return out;
    })();                            // fighter -> { s, at }
    let lastStatsSent = 0;

    comms.on("stats", function (data, from) {
        if (!config.characters[from] || !data || !data.max_hp) return;
        stats[from] = { s: data, at: Date.now() };
        try { set(STATS_KEY, stats); } catch (e) { /* storage unavailable */ }
    });

    // Every fighter tells every other one: the warrior's live check (mobbing escape, protective Agitate) needs the
    // priest's healing and the team's stats too.
    function shareStats() {
        const party = deps.party;
        if (!party.enabled || Date.now() - lastStatsSent < 60 * 1000) return;
        lastStatsSent = Date.now();
        const me = util.combatStats();
        config.team.fighters.forEach(function (n) {
            if (n !== character.name && party.inParty(n)) comms.send(n, "stats", me);
        });
    }

    function teamStats() {
        const party = deps.party;
        const list = [util.combatStats()];
        const now = Date.now();
        Object.keys(stats).forEach(function (name) {
            if (party.inParty(name) && now - stats[name].at < 3 * 60 * 1000) list.push(stats[name].s);
        });
        return list;
    }

    // reports: the raw reports by name ({ s, at }) - events' runner check reads one fighter's last report.
    return { shareStats: shareStats, teamStats: teamStats, reports: stats };
};
