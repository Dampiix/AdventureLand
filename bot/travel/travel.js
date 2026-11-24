// =====================================================================
// travel/travel.js - path walks to a goal (module plan, stage 3b; moved out of core/fighter.js unchanged):
//   - travel(destination, label, farm): one path walk at a time; a new goal turns a running walk around; the leader
//     makes its farm target the team goal (party.setGoal "spot")
//   - waypoints (config.travel.via): a map behind a dangerous one is reached through a safe map first
//   - goals without a path are skipped for a minute (goalFor falls back to the monster's spawn)
//   - endSearchWalk(): a target in sight ends our own search walk (not other path walks)
// deps: { game, util, config, party, targeting, cls } - party and targeting may be getters.
// =====================================================================

module.exports = function createTravel(deps) {
    const game = deps.game, util = deps.util, config = deps.config;

    // A target in sight ends the search walk: smart_move kept walking to the middle of the spawn while we fought on the
    // way. Only our own search walk is stopped: the way to a target behind a wall is a smart_move too (xmove), and
    // stopping that every tick left the team standing in town.
    let searchWalk = 0;          // id of the running search walk, 0 = none
    let stoppedOnPurpose = false;
    function pathing() { const s = game.path(); return !!(s && s.moving); }
    function endSearchWalk() {
        if (!searchWalk || !game.path() || !game.path().moving) return;
        searchWalk = 0;
        stoppedOnPurpose = true;
        game.stopAction();
    }

    // A new goal while still walking to an old one turns us around (the walk to the old goal ran to its end first, and
    // the members followed the old goal).
    let travelGoal = null;
    function sameGoal(a, b) {
        if (!a || !b) return false;
        if (typeof a === "string" || typeof b === "string") return a === b;
        return a.map === b.map && Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)) < 150;
    }
    // Waypoints (config.travel.via): a map reached through a dangerous one goes via a safe map first (main -> level1 ->
    // spookytown walks through the Vampire Rats). In the waypoint map we first walk to its own door to the destination:
    // the path search found "back the way we came" shorter, and we looped between the maps.
    function viaFor(destination) {
        const character = game.me(), G = game.data();
        const via = ((config.travel || {}).via) || {};
        const map = destination && typeof destination === "object" ? destination.map : null;
        const v = map && via[map];
        if (!v || character.map === map) return destination;
        if (character.map !== v) return { map: v };
        // The door's own spawn point in this map (door[6]) - walkable, right next to the door.
        const vm = G.maps[v] || {};
        const door = (vm.doors || []).find(function (d) { return d[4] === map; });
        const at = door && vm.spawns && vm.spawns[door[6]];
        if (!at || Math.hypot(character.real_x - at[0], character.real_y - at[1]) < 80) return destination;
        return { map: v, x: at[0], y: at[1] };
    }
    // farm: the farm target we walk to - the leader makes it the team goal (party.setGoal); boss events are the leader's
    // event goal (party.leaderGoal), not set here.
    function travel(destination, label, farm) {
        const party = deps.party, targeting = deps.targeting, cls = deps.cls;
        if (farm && farm.monster && party.isLeader && String(farm.source || "").indexOf("event ") !== 0) {
            party.setGoal("spot", farm.monster, destination && typeof destination === "object" ? destination : (targeting.spotFor ? targeting.spotFor(farm.monster, farm.map) : null));
        }
        const goal = destination; // the real goal: a failed walk marks it, not the waypoint
        destination = viaFor(destination);
        util.status(label, "yellow");
        const character = game.me();
        if (game.isMoving(character) && travelGoal && !sameGoal(travelGoal, destination) && pathing()) {
            stoppedOnPurpose = true;
            try { game.stopAction("smart"); } catch (e) { /* not walking */ }
        }
        travelGoal = destination;
        if (!game.isMoving(character)) {
            const id = Date.now();
            searchWalk = id;
            game.smartMove(destination).then(function () {
                if (searchWalk === id) searchWalk = 0;
            }).catch(function (e) {
                if (searchWalk === id) searchWalk = 0;
                if (stoppedOnPurpose) { stoppedOnPurpose = false; return; } // we stopped it for a target
                const why = util.errReason(e);
                if (!/interrupt|stop/i.test(why) && destination === goal) markBadGoal(goal);
                util.log("move", "route to " + JSON.stringify(destination) + " failed: " + why, "red");
            });
        } else if (cls.move) {
            cls.move(null); // e.g. Warrior Charge on the way
        }
    }
    // Meeting points without a path: a boss's meeting point (where the finder stood) can lie on a spot the path search
    // can't reach ("Path not found!" again and again). Such a point is skipped for a minute; we walk to the boss's spawn
    // instead (smart_move by monster name).
    const badGoals = [];
    function markBadGoal(d) {
        if (d && typeof d === "object" && d.map) badGoals.push({ map: d.map, x: d.x, y: d.y, until: Date.now() + 60 * 1000 });
    }
    function isBadGoal(d) {
        const now = Date.now();
        for (let i = badGoals.length - 1; i >= 0; i--) if (badGoals[i].until < now) badGoals.splice(i, 1);
        return !!d && typeof d === "object" && badGoals.some(function (b) { return b.map === d.map && Math.hypot(b.x - d.x, b.y - d.y) < 60; });
    }
    function goalFor(farm) {
        if (farm.dest && !isBadGoal(farm.dest)) return farm.dest;
        if (farm.dest) return farm.monster;
        return deps.targeting.spotFor(farm.monster, farm.map) || farm.monster;
    }

    return {
        travel: travel,
        viaFor: viaFor,
        goalFor: goalFor,
        endSearchWalk: endSearchWalk,
        searching: function () { return !!searchWalk; },          // our own search walk runs
        // A walk we stop ourselves (a target, a team wait, a step out of a rage zone) is no failed walk.
        stopOnPurpose: function () { stoppedOnPurpose = true; },
    };
};
