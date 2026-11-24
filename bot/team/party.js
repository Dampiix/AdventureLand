// =====================================================================
// bot_party – party membership and formation (active in phases that
// list more than one party member, see config.phases[phase].party).
//
// Leader:  invites missing members, broadcasts its position, farm target
//          and current target to the others every few seconds.
// Members: accept invites from the leader only, leave any other party,
//          follow the leader to its map and route end (no distance leash
//          any more, see keepUp) and assist instead of opening fights
//          themselves. party.leash is still read by the warrior (Agitate
//          stays near the leader) and by targeting's rage-zone verdict.
//
// deps (module plan, stage 4a): { config, util, comms, bus } - the leader's goal reads the bus (boss, search, manual)
// and the spot geometry (safety/spots.js) instead of events, cave and targeting: no dependency cycle.
// =====================================================================

const game = require("../lib/game.js");
const createSpots = require("../safety/spots.js");
const createTeamView = require("./team-view.js");

module.exports = function createParty(deps) {
    const config = deps.config;
    const util = deps.util;
    const comms = deps.comms;
    const bus = deps.bus;
    const spots = createSpots({ game: game, util: util, config: config });
    const teamView = createTeamView({ game: game }); // read only: the leader's entry (team view step 1)
    const cfg = config.party;
    const leader = config.leader;
    const phase = config.phases[config.phase] || {};
    const members = phase.party || [];
    const isLeader = character.name === leader;
    const enabled = members.length > 1 && members.includes(character.name);

    const lastInvite = {};
    let lastManage = 0;
    let lastBroadcast = 0;
    let leaderState = null; // last "lead" message: { map, x, y, farm, target, at }

    comms.on("lead", function (data, from) {
        if (from === leader) leaderState = Object.assign({}, data, { at: Date.now() });
    });

    // Names currently in our party (including us), as reported by the server.
    function memberNames() {
        return Object.keys(get_party() || {});
    }

    function inParty(name) {
        return Object.prototype.hasOwnProperty.call(get_party() || {}, name);
    }

    // Invite / accept / leave – throttled, runs every couple of seconds.
    function manage() {
        if (!enabled) return;
        const now = Date.now();
        if (now - lastManage < 2000) return;
        lastManage = now;

        if (isLeader) {
            members.forEach(function (name) {
                if (name === character.name || inParty(name)) return;
                if (now - (lastInvite[name] || 0) < cfg.inviteEveryMs) return;
                lastInvite[name] = now;
                send_party_invite(name).catch(function () {}); // fails quietly while the member is offline
            });
        } else if (character.party && character.party !== leader) {
            util.log("party", "in " + character.party + "'s party - leaving", "orange");
            leave_party().catch(function () {});
        }
    }

    // Called from on_party_invite in bot_main.
    function onInvite(name) {
        if (!enabled || name !== leader) return;
        accept_party_invite(name)
            .then(function () { util.log("party", "joined " + name + "'s party", "green"); })
            .catch(function (e) { util.log("party", "could not join: " + util.errReason(e), "red"); });
    }

    // ---- Team goal (v1.236.0, player decision 2026-11-24) ----------------------------------------------------------
    // The leader sets one goal for the whole team and sends it as the END goal - never a door, map edge or waypoint:
    //   { id, kind, name, map, x, y, reached }
    //   kind "spot"   - a farm spot (name = the monster), set by the leader's walk to it (fighter.travel)
    //   kind "boss"   - the leader's boss event (name = the boss, map/x/y = where it was seen, if known)
    //   kind "daisy"  - a trip to Daisy (hunts.visitDaisy)
    //   kind "search" - a boss search: everyone walks its own areas, no team goal to go ahead to or port to
    // A new goal gets a new id (also the same spot again after a boss in between). `reached`: the leader itself is there.
    // Everyone walks there on its own path; whoever can cast Magiport pulls the team once it is there itself
    // (team/team-port.js tick, run by the mage). Independent of who leads and of the classes in the team.
    let setGoalNow = null; // leader: { kind, name, point } from the last route the leader chose
    let goalNow = null;    // leader: the effective goal with its id
    function setGoal(kind, name, point) {
        if (!enabled || !isLeader) return;
        setGoalNow = { kind: kind, name: name || null, point: point && typeof point === "object" && point.map ? { map: point.map, x: Math.round(point.x || 0), y: Math.round(point.y || 0) } : null };
    }
    function goalKey(g) {
        const p = g.kind === "boss" || !g.point || g.point.x === undefined ? "" : ":" + g.point.map + ":" + Math.round(g.point.x / 100) + ":" + Math.round(g.point.y / 100);
        return g.kind + ":" + (g.name || "") + p;
    }
    // Radius around a goal that counts as there: a farm spot - inside its area or within `edge` px of its edge point;
    // any other goal - within `radius` px of its point. Bosses: in our sight (the caller's own check, it needs bossRange).
    function atGoal(g, edge, radius) {
        if (!g || character.rip) return false;
        if (edge === undefined) edge = cfg.goalEdge || 250;
        if (radius === undefined) radius = cfg.goalRadius || 200;
        const me = { map: character.map, x: character.real_x, y: character.real_y };
        if (g.kind === "spot") {
            if (!g.name) return false;
            if (g.map && g.map !== character.map) return false;
            if (spots.inSpotArea(me, g.name)) return true;
            const e = spots.watchPoint(g.name);
            return !!e && util.distanceTo(e) <= edge;
        }
        if (g.kind === "daisy" || g.kind === "point") {
            return g.map === character.map && typeof g.x === "number" && Math.hypot(me.x - g.x, me.y - g.y) <= radius;
        }
        return false;
    }
    function leaderGoal() {
        if (!enabled || !isLeader) return null;
        let want = null;
        const ev = bus.get("boss");           // events: the current boss event
        if (bus.get("manual")) want = null;   // cave: manual rules
        else if (bus.get("search")) want = { kind: "search", name: null, point: null };
        else if (ev && ev.join) want = null;
        else if (ev && ev.monster && !ev.solo) want = { kind: "boss", name: ev.monster, point: ev.dest && typeof ev.dest === "object" ? ev.dest : null };
        else want = setGoalNow;
        // A boss, a search or a join event replaces the route goal from before: after it the leader's next walk sets a
        // new one (an old spot or Daisy goal would come back for a moment and send the team there).
        if (want !== setGoalNow) setGoalNow = null;
        if (!want) { goalNow = null; return null; }
        const key = goalKey(want);
        if (!goalNow || goalNow.key !== key) {
            goalNow = { key: key, id: key + "@" + Date.now(), kind: want.kind, name: want.name, reached: false };
            util.log("party", "team goal: " + goalLabel(goalNow) + (want.point ? " (" + want.point.map + ")" : ""), "white");
        }
        if (want.point) { goalNow.map = want.point.map; goalNow.x = want.point.x; goalNow.y = want.point.y; }
        if (!goalNow.reached && atGoal(goalNow)) goalNow.reached = true;
        return goalNow;
    }
    function goalLabel(g) {
        if (!g) return "none";
        return g.kind === "spot" ? "the " + g.name + " spot" : g.kind === "boss" ? "the " + g.name : g.kind === "daisy" ? "Daisy" : g.kind === "search" ? "boss search" : (g.name || "the route end");
    }
    // The team's goal now: the leader's own, or the leader's last broadcast (members), or null.
    function teamGoal() {
        if (!enabled) return null;
        if (isLeader) return goalNow;
        const lead = leaderInfo();
        return lead && lead.goal ? lead.goal : null;
    }
    // Goals we have been at (members; the leader uses `reached`): a goal we were at once is not one we are pulled to
    // again - e.g. a member on a potion trip later, while the team farms at that spot.
    const beenAt = {}; // goal id -> true
    function markBeenAt(g) {
        if (!g || !g.id || beenAt[g.id]) return;
        beenAt[g.id] = Date.now();
        const ids = Object.keys(beenAt);
        if (ids.length > 30) ids.sort(function (a, b) { return beenAt[a] - beenAt[b]; }).slice(0, ids.length - 30).forEach(function (k) { delete beenAt[k]; });
    }
    function wasAtGoal(g) {
        if (!g) return false;
        if (isLeader) return !!g.reached;
        return !!beenAt[g.id];
    }

    // The leader's report to the members: where it is, what it farms and targets, its route end, event, manual flag and
    // the team goal. Sent as the "lead" message every broadcastMs, and read live from our team view entry (leadData).
    let lastLead = { farm: null, target: null, event: null };
    function leadPayload(farm, target, event, g) {
        return {
            map: character.map,
            x: Math.round(character.x),
            y: Math.round(character.y),
            farm: farm ? farm.monster : null,
            target: target ? target.id : null,
            moving: typeof smart !== "undefined" && !!smart.moving, // on a route (members don't fight meanwhile)
            // Where the route ends: members walk there themselves instead of following us door by door.
            dest: cfg.goToDest !== false && typeof smart !== "undefined" && smart.moving && smart.map ? { map: smart.map, x: Math.round(smart.x), y: Math.round(smart.y) } : null,
            // dest: where a roaming boss was seen (a member's sighting) - members go there, not to its nearest spawn.
            event: event ? { name: event.name, join: !!event.join, monster: event.monster || null, dest: event.dest && typeof event.dest === "object" ? event.dest : null } : null,
            manual: !!bus.get("manualOwn"), // /manual: members use the manual rules too
            // The team goal: the end goal of the team's route, see leaderGoal.
            goal: g ? { id: g.id, kind: g.kind, name: g.name, map: g.map || null, x: g.x, y: g.y, reached: !!g.reached } : null,
        };
    }
    function broadcast(farm, target, event) {
        if (!enabled || !isLeader) return;
        lastLead = { farm: farm, target: target, event: event };
        const now = Date.now();
        const g = leaderGoal(); // every tick: the goal's id and `reached` stay current between broadcasts
        if (now - lastBroadcast < cfg.broadcastMs) return;
        lastBroadcast = now;
        // Only members in the party: an offline member made every send fail. events.shareStats filters the same way.
        const others = members.filter(function (n) { return n !== character.name && inParty(n); });
        if (!others.length) return;
        comms.send(others, "lead", leadPayload(farm, target, event, g)); // the fallback for members outside our client
    }
    // Leader: the same report, live (read by the members through our team view entry). The goal as of our last tick.
    function leadData() {
        if (!enabled || !isLeader) return null;
        return leadPayload(lastLead.farm, lastLead.target, lastLead.event, goalNow);
    }


    // Fresh leader info for members, or null.
    // Members: the leader's report - live from its team view entry when it runs in our client (team view step 1), else
    // the last "lead" message (up to 15 s old). The journal notes when the source changes.
    let leadSource = null;
    function noteSource(src) {
        if (src === leadSource) return;
        leadSource = src;
        util.log("party", "leader info: " + (src === "view" ? "live from the team view" : src === "message" ? "from the leader's messages" : "none"), "white");
    }
    function leaderInfo() {
        if (!enabled || isLeader) return null;
        let live = null;
        try {
            const e = teamView.member(leader);
            live = e && e.bot && e.bot.lead ? e.bot.lead() : null;
        } catch (x) { live = null; } // a reloading frame: use the message
        if (live) { noteSource("view"); return Object.assign(live, { at: Date.now() }); }
        if (!leaderState || Date.now() - leaderState.at > 15000) { noteSource(null); return null; }
        noteSource("message");
        return leaderState;
    }
    function leadVia() { return leadSource; }

    // isDest: the end of the leader's route - a new destination replaces our current walk.
    let lastGoal = null;
    function moveTowards(point, label, isDest) {
        // In the cave (v1.231.3, 2026-11-24 first run): never a path walk to another map - the warrior's smart_move to
        // the leader's map walked him out of the cave a minute after entering. Same cave map: a straight move only.
        if (character.cave) {
            if (point.map !== character.map) { util.status("leader on another cave map - waiting", "yellow"); return; }
            util.status(label, "yellow");
            if (!is_moving(character)) xmove(point.x, point.y);
            return;
        }
        util.status(label, "yellow");
        if (isDest) {
            const same = lastGoal && lastGoal.map === point.map && Math.hypot(lastGoal.x - point.x, lastGoal.y - point.y) < 100;
            if (same && is_moving(character)) return;
            lastGoal = { map: point.map, x: point.x, y: point.y };
            smart_move({ map: point.map, x: point.x, y: point.y }).catch(function (e) {
                // No path to that meeting point (2026-11-21, the cave): skip it for a minute and
                // follow the leader itself instead (travelDest).
                if (!/interrupt|stop/i.test(util.errReason(e))) badDest = { map: point.map, x: point.x, y: point.y, until: Date.now() + 60 * 1000 };
            });
            return;
        }
        lastGoal = null;
        if (is_moving(character)) return;
        if (character.map !== point.map) {
            smart_move({ map: point.map, x: point.x, y: point.y }).catch(function () {});
        } else {
            xmove(point.x, point.y);
        }
    }

    // Members: the leader farms a monster we must not hit (melee vs. damage return, e.g.
    // porcupines for pleather) - then we farm on our own (own guide pick, no leash) until
    // the leader moves on. Events and bosses still bring everyone together.
    let wasDetached = false;
    function detached() {
        const lead = leaderInfo();
        const now = !!(lead && !lead.event && lead.farm && util.tooSpiky(config, lead.farm));
        if (now !== wasDetached) {
            wasDetached = now;
            util.log("party", now ? leader + " farms " + lead.farm + " (damage return, not for melee) - farming on my own meanwhile"
                : "back with " + leader, "yellow");
        }
        return now;
    }

    // Members (player request 2026-11-18): while the leader is on a route and fights nothing,
    // we follow and don't fight either - the warrior kept getting into fights on the way.
    function leaderTravels() {
        if (!enabled || isLeader || detached()) return false;
        const lead = leaderInfo();
        return !!(lead && lead.moving && !lead.target && !lead.event);
    }

    // The end of the leader's route while it travels (fresh broadcast), or null.
    let badDest = null; // a leader's route end we found no path to (moveTowards)
    let lastLeadDest = null; // { d, at }: the leader's last route end we went ahead to
    // Not ahead into the leader's farm spot (2026-11-22): its route ends in the middle of the spawn, but the leader
    // stops at the edge for the spot check - the warrior went ahead into the 5-booboo rage zone alone. A route end
    // within the spot check's edge of a spawn of the leader's farm target: we follow the leader instead.
    function travelDest(lead) {
        const d = lead && lead.moving && lead.dest && lead.dest.map ? lead.dest : null;
        if (d && badDest && Date.now() < badDest.until && badDest.map === d.map && Math.hypot(badDest.x - d.x, badDest.y - d.y) < 60) return null;
        // Any map (2026-11-22: started in halloween, the walk went on into the booboo spawn in spookytown).
        if (d && lead.farm && spots.inSpotArea(d, lead.farm)) return null;
        return d;
    }

    // Members: follow the leader to its map and ahead to the end of its route. Returns true when we
    // must move instead of fighting. No distance leash on the same map any more (player decision
    // 2026-11-21): we meet at the destination, and in a fight the distance to the leader only spoiled
    // kiting - members without a target go back to the leader anyway (idleFollow).
    // `loose` (join events): on the leader's map we roam freely after our own targets.
    // Going ahead to the team goal (v1.236.0, player decision 2026-11-24): every member walks its own path to the goal
    // the leader sent - a farm spot to its edge (never into the spawn: the spot check is the leader's), Daisy or another
    // point to the point itself - and waits there until the leader is there too (goal.reached); it never walks back to
    // the leader meanwhile. Boss goals: the boss logic walks us (events/targeting), searches: everyone its own areas.
    // null: no goal for us to go to (follow the leader as before); "hold": we are there and wait; "go": walking there.
    let holdingAt = 0; // we wait at the goal for the leader: no free pulls meanwhile (nearLeader)
    function goalStep(lead) {
        const g = lead && lead.goal;
        if (!g || (g.kind !== "spot" && g.kind !== "daisy" && g.kind !== "point")) return null;
        const here = atGoal(g);
        if (here) markBeenAt(g);
        if (g.reached) return null; // the leader is there too: back to the usual rules (fight, follow it in the spot)
        if (here) { holdingAt = Date.now(); return "hold"; }
        if (!g.map || typeof g.x !== "number") return null; // a spot without a known point: follow the leader
        if (badDest && Date.now() < badDest.until && badDest.map === g.map && Math.hypot(badDest.x - g.x, badDest.y - g.y) < 60) return null;
        const label = "to goal: " + goalLabel(g);
        if (g.kind === "spot" && character.map === g.map) {
            const e = spots.watchPoint(g.name);
            if (e) { moveTowards({ map: character.map, x: e.x, y: e.y }, label, true); return "go"; }
        }
        moveTowards({ map: g.map, x: g.x, y: g.y }, label, true);
        return "go";
    }
    function holdAtGoal(lead) {
        if (is_moving(character) && typeof smart !== "undefined" && smart.moving) { try { stop("smart"); } catch (e) { /* not walking */ } }
        util.status("at goal, waiting: " + goalLabel(lead.goal), "white");
    }
    function keepUp(loose) {
        const lead = leaderInfo();
        if (!lead || detached()) return false;
        if (loose && character.map === lead.map) return false;
        const step = goalStep(lead);
        if (step === "hold") return false; // idleFollow holds us here while we have no target
        if (step === "go") return true;
        const dest = travelDest(lead);
        if (dest) {
            if (character.map !== dest.map || util.distanceTo(dest) > cfg.followDistance) { moveTowards(dest, "going ahead to " + dest.map, true); return true; }
            return false;
        }
        if (character.map !== lead.map) {
            moveTowards(lead, "following " + leader);
            return true;
        }
        return false;
    }

    // Members without a target: stay close to the leader. Without a fresh
    // broadcast (e.g. right after a restart) use the leader if it is visible,
    // otherwise wait where we are – never wander off alone.
    // Farm radius (2026-11-22): a member only picks FREE monsters within party.farmRadius of the leader (same map,
    // not detached). In the bat cave there are bats everywhere - the warrior, back from a restart, streamed from clump
    // to clump ~1,000 px away from the priest and never came back (idleFollow only runs without a target). Monsters
    // already on us are fought wherever they are. true when the point is fine.
    function nearLeader(p) {
        if (!enabled || isLeader || detached() || !p) return true;
        // Waiting at the team goal for the leader (v1.236.0): no free monster alone - ones attacking us are fought anyway.
        if (Date.now() - holdingAt < 1500) return false;
        const lead = leaderInfo();
        if (!lead || lead.map !== character.map) return true;
        const q = util.xy(p);
        return Math.hypot(q.x - lead.x, q.y - lead.y) <= (cfg.farmRadius || 400);
    }
    function idleFollow() {
        if (!enabled || isLeader || detached()) return false;
        let lead = leaderInfo();
        if (!lead) {
            const visible = get_player(leader);
            if (visible) {
                const p = util.xy(visible);
                lead = { map: character.map, x: p.x, y: p.y };
            }
        }
        if (!lead) {
            util.status("waiting for " + leader, "white");
            return true;
        }
        const step = goalStep(lead);
        if (step === "hold") { holdAtGoal(lead); return true; }
        if (step === "go") return true;
        const dest = travelDest(lead);
        if (dest) lastLeadDest = { d: dest, at: Date.now() };
        // At the leader's last route end while it stops for a moment (2026-11-22): stay there instead of walking back
        // to it - the leader no longer waits for members at its next goal (fighter.waitForTeam).
        // Only while the leader really stands (v1.234.1, player report 2026-11-24): its next route into a farm spot sends
        // no end point (travelDest), and warrior and mage waited at Daisy - the old route end - until it changed maps.
        const prev = !dest && !lead.moving && lastLeadDest && Date.now() - lastLeadDest.at < 30 * 1000 ? lastLeadDest.d : null;
        if (prev && prev.map === character.map && lead.map === character.map && util.distanceTo(prev) <= (cfg.waitDistance || 500)) {
            util.status("waiting for " + leader + " ahead", "white");
            return true;
        }
        if (dest) {
            if (character.map !== dest.map || util.distanceTo(dest) > cfg.followDistance) moveTowards(dest, "going ahead to " + dest.map, true);
            else util.status("waiting for " + leader + " at the spot", "white");
            return true;
        }
        // Another map counts as far (the distance alone compared coordinates across maps).
        if (lead.map !== character.map || util.distanceTo(lead) > cfg.followDistance) moveTowards(lead, "following " + leader);
        else util.status("waiting near " + leader, "white");
        return true;
    }

    return {
        enabled: enabled,
        isLeader: isLeader,
        isMember: enabled && !isLeader,
        memberNames: memberNames,
        inParty: inParty,
        manage: manage,
        onInvite: onInvite,
        broadcast: broadcast,
        leaderInfo: leaderInfo,
        leadData: leadData,  // leader: the live report for our team view entry
        leadVia: leadVia,    // members: "view" or "message" (/team)
        keepUp: keepUp,
        idleFollow: idleFollow,
        nearLeader: nearLeader,
        detached: detached,
        leaderTravels: leaderTravels,
        // Team goal (v1.236.0): the leader sets it (fighter.travel, hunts.visitDaisy), everyone reads it.
        setGoal: setGoal,
        teamGoal: teamGoal,
        atGoal: atGoal,
        wasAtGoal: wasAtGoal,
        goalLabel: goalLabel,
    };
};
