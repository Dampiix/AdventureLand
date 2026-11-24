// =====================================================================
// team/team-port.js - magiport consent: accept a team mage's magiport for a boss fight or a team goal we have not been at.
// Part of bot_events (module plan, stage 4c): moved verbatim from the old single-file core/events.js. The parts
// share one internal state (evs: the current event, searches, runners, sightings) and call each other through evs;
// outside dependencies come in deps (game, util, config, comms, party, cave, bus, teamStats).
// =====================================================================

module.exports = function install(evs, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;

    // Magiport consent (v1.236.0, player decision 2026-11-24): the game asks us (on_magiport) when a mage pulls us to it.
    // Accepted from a team fighter in our party while we are alive and
    //   - the team fights a boss (the leader's boss event, not a join event or a runner's solo kill), or
    //   - the team has a goal (party.teamGoal: a farm spot, a boss, Daisy, ...) we have not been at yet.
    // Declined in the cave or under /manual, during a boss search (ours or the team's - everyone walks its own areas;
    // a find becomes the boss goal) and for a goal we have been at already (e.g. we left the spot for potions later).
    // "" when the port is fine, else why not (logged).
    function portWhyNot() {
        if (deps.cave && deps.cave.active()) return "manual mode";
        const g = party.teamGoal ? party.teamGoal() : null;
        if (!g) return "no team goal";
        if (g.kind === "search") return "the team searches a boss";
        if (g.kind !== "boss" && (evs.job || evs.searching)) return "own boss search";
        if (party.wasAtGoal(g)) return "already been at " + party.goalLabel(g);
        return "";
    }
    function acceptMagiport(name) {
        const mcfg = ((config.classes || {}).mage || {}).magiport || {};
        const fighters = (config.team && config.team.fighters) || [];
        const boss = !!(evs.current && evs.current.monster && !evs.current.join && !evs.current.solo);
        const goalWhy = boss ? "" : portWhyNot();
        const why = !mcfg.enabled ? "magiport off" : name === character.name ? "own" : !fighters.includes(name) ? "not one of our fighters" :
            !party.inParty(name) ? "not in our party" : character.rip ? "dead" : goalWhy ? goalWhy : null;
        if (why) {
            util.log("event", "magiport from " + name + " declined: " + why, "orange");
            return;
        }
        try { stop(); } catch (e) { /* not walking */ }
        const g = party.teamGoal ? party.teamGoal() : null;
        const what = boss ? evs.current.name : party.goalLabel(g);
        // A path walk planned from where we stood before the port is dropped after it (v1.235.9, player report: priest
        // and warrior walked on to their old point first): the next tick plans from the landing point.
        const dropOldWalk = function () { try { if (typeof smart !== "undefined" && smart.moving) stop("smart"); } catch (e) { /* not walking */ } };
        accept_magiport(name)
            .then(function () {
                util.log("event", "magiported to " + name + " for " + what, "green");
                setTimeout(dropOldWalk, 400);
                setTimeout(dropOldWalk, 1500);
            })
            .catch(function (e) { util.log("event", "magiport from " + name + " failed: " + util.errReason(e), "orange"); });
    }

    Object.assign(evs, {
        portWhyNot: portWhyNot,
        acceptMagiport: acceptMagiport,
    });
};
