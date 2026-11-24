// =====================================================================
// combat/passing.js - passing through attackers on the way, leaving a fight with another kind than the farm target, unstacking.
// Part of bot_fighter (module plan, stage 5): moved verbatim from the old single-file core/fighter.js. The parts share
// one internal state (ftr: the farm target, walks, waits, the strike intent, chests) and call each other through ftr;
// outside dependencies come in deps (game, util, config, comms, bus, party, targeting, supply, events, cave, hunts,
// gear, teamStats, cls - the class module).
// =====================================================================

module.exports = function install(ftr, deps) {
    const config = deps.config;
    const util = deps.util;
    const quiet = util.quiet;
    const targeting = deps.targeting;
    const party = deps.party;

    function unstack(data) {
        if (!data || data.id !== character.id || !Array.isArray(data.stacked) || !data.stacked.includes(character.id)) return;
        if (character.rip || is_moving(character) || Date.now() - ftr.lastUnstack < 250) return;
        const x = character.x - 25 + Math.round(50 * Math.random()), y = character.y - 25 + Math.round(50 * Math.random());
        if (!can_move_to(x, y)) return;
        ftr.lastUnstack = Date.now();
        quiet(move(x, y));
    }
    function stuckOffTarget(farm, target) {
        const pt = config.combat.passThrough || {};
        if (!pt.leaveAfterMs || !farm || farm.any || !farm.monster || !target || target.mtype === farm.monster) { ftr.offSince = 0; return false; }
        // Never out of a boss fight (player decision 2026-11-21: the team left Dracul at 5 % HP after
        // 60 s "for the Phoenix" - which stood right next to them - and walked off to its spawn).
        if (isBossType(target.mtype)) { ftr.offSince = 0; return false; }
        const now = Date.now();
        if (!ftr.offSince || now - ftr.offSeen > 5000) ftr.offSince = now;
        ftr.offSeen = now;
        if (now - ftr.offSince < pt.leaveAfterMs) return false;
        if (now - ftr.leaveLogged > 60 * 1000) { ftr.leaveLogged = now; util.log("combat", "still fighting " + target.mtype + " after " + Math.round((now - ftr.offSince) / 1000) + " s - leaving for " + farm.monster, "yellow"); }
        return true;
    }
    function isBossType(mtype) {
        const ev = config.events || {};
        const def = G.monsters[mtype] || {};
        return (ev.search || []).concat(ev.engage || []).includes(mtype) || !!def.cooperative;
    }
    function leaderGone() {
        const lead = party.leaderInfo ? party.leaderInfo() : null;
        if (!lead) return false;
        if (lead.map !== character.map) return true;
        return Math.hypot(lead.x - character.x, lead.y - character.y) > ((config.party || {}).farmRadius || 400);
    }
    function startPassing(farm) {
        ftr.passing = { until: Date.now() + 3000, dest: farm.dest || targeting.spotFor(farm.monster, farm.map) || farm.monster };
    }
    function passThrough(farm, target) {
        const pt = config.combat.passThrough || {};
        if (!pt.enabled || !farm || farm.any || !farm.monster || target.mtype === farm.monster || isBossType(target.mtype)) { ftr.offSince = 0; return false; }
        if (stuckOffTarget(farm, target)) {
            const spot0 = targeting.spotFor(farm.monster, farm.map);
            return !(spot0 && spot0.map === character.map && util.distanceTo(spot0) < (pt.spotRadius || 400));
        }
        const ours = [character.name].concat(party.enabled ? party.memberNames() : []);
        const attackers = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target && ours.includes(e.target);
        });
        // On the way we only fight back against the farm kind (2026-11-23, player decision). Server rule (node/server.js):
        // a monster without rage hits a passer-by in front of it but never takes up the chase - only our own hit, a taunt
        // or Agitate makes it follow, and with rage 0 it gives up 20 s after our last hit. So other kinds without rage
        // are passed by every fighter (members too, leader present or not), at any HP and any speed - hitting a Fire
        // Spirit (84k HP, 280 px reach) back is what keeps it on us. Not at the spot (spotRadius), never bosses (above).
        const noChase = function (e) { return e.mtype !== farm.monster && !(((G.monsters[e.mtype] || {}).rage || 0) > 0); };
        const spotNow = targeting.spotFor(farm.monster, farm.map);
        const arrivedNow = !!spotNow && spotNow.map === character.map && util.distanceTo(spotNow) < (pt.spotRadius || 400);
        // Only when something hits us or ours (a free one the pick chose - a rare monster - stays as before).
        if (!arrivedNow && (attackers.length || target.target) && noChase(target) && attackers.every(noChase)) return true;
        // Members follow the leader - unless the leader is gone already (another map, or beyond party.farmRadius):
        // then they pass slow attackers too instead of fighting them for leaveAfterMs (2026-11-22, player decision).
        if (party.enabled && party.isMember && !party.detached() && !leaderGone()) return false;
        if (util.hpRatio() < (pt.minHp || 0.5)) return false;
        const spot = targeting.spotFor(farm.monster, farm.map);
        if (spot && spot.map === character.map && util.distanceTo(spot) < (pt.spotRadius || 400)) return false; // arrived
        const mine = character.speed || 0;
        if (!attackers.length && !target.target) return false; // a free one: just don't pull it (pick decides)
        return attackers.every(function (e) {
            return e.mtype !== farm.monster && (e.speed || (G.monsters[e.mtype] || {}).speed || 0) < mine * (pt.speedShare || 0.8);
        });
    }

    Object.assign(ftr, {
        unstack: unstack,
        stuckOffTarget: stuckOffTarget,
        isBossType: isBossType,
        leaderGone: leaderGone,
        startPassing: startPassing,
        passThrough: passThrough,
    });
};
