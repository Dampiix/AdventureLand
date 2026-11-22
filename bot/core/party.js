// =====================================================================
// bot_party – party membership and formation (active in phases that
// list more than one party member, see config.phases[phase].party).
//
// Leader:  invites missing members, broadcasts its position, farm target
//          and current target to the others every few seconds.
// Members: accept invites from the leader only, leave any other party,
//          follow the leader (same map, within the leash range) and
//          assist instead of opening fights themselves.
// =====================================================================

module.exports = function createParty(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
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

    function broadcast(farm, target, event) {
        if (!enabled || !isLeader) return;
        const now = Date.now();
        if (now - lastBroadcast < cfg.broadcastMs) return;
        lastBroadcast = now;
        const others = members.filter(function (n) { return n !== character.name; });
        comms.send(others, "lead", {
            map: character.map,
            x: Math.round(character.x),
            y: Math.round(character.y),
            farm: farm ? farm.monster : null,
            target: target ? target.id : null,
            moving: typeof smart !== "undefined" && !!smart.moving, // on a route (members don't fight meanwhile)
            // Where the route ends (player decision 2026-11-21, idea from earthiverse): members walk
            // there themselves instead of following us door by door.
            dest: cfg.goToDest !== false && typeof smart !== "undefined" && smart.moving && smart.map ? { map: smart.map, x: Math.round(smart.x), y: Math.round(smart.y) } : null,
            // dest: where a roaming boss was seen (a member's sighting) - members go there, not to its nearest spawn.
            event: event ? { name: event.name, join: !!event.join, monster: event.monster || null, dest: event.dest && typeof event.dest === "object" ? event.dest : null } : null,
        });
    }

    // Fresh leader info for members, or null.
    function leaderInfo() {
        if (!enabled || isLeader || !leaderState) return null;
        if (Date.now() - leaderState.at > 15000) return null;
        return leaderState;
    }

    // isDest: the end of the leader's route - a new destination replaces our current walk.
    let lastGoal = null;
    function moveTowards(point, label, isDest) {
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
        if (d && lead.farm && ctx.targeting && ctx.targeting.inSpotArea && ctx.targeting.inSpotArea(d, lead.farm)) return null;
        return d;
    }

    // Members: follow the leader to its map and ahead to the end of its route. Returns true when we
    // must move instead of fighting. No distance leash on the same map any more (player decision
    // 2026-11-21): we meet at the destination, and in a fight the distance to the leader only spoiled
    // kiting - members without a target go back to the leader anyway (idleFollow).
    // `loose` (join events): on the leader's map we roam freely after our own targets.
    function keepUp(loose) {
        const lead = leaderInfo();
        if (!lead || detached()) return false;
        if (loose && character.map === lead.map) return false;
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
        const dest = travelDest(lead);
        if (dest) lastLeadDest = { d: dest, at: Date.now() };
        // At the leader's last route end while it stops for a moment (2026-11-22): stay there instead of walking back
        // to it - the leader no longer waits for members at its next goal (fighter.waitForTeam).
        const prev = !dest && lastLeadDest && Date.now() - lastLeadDest.at < 30 * 1000 ? lastLeadDest.d : null;
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
        keepUp: keepUp,
        idleFollow: idleFollow,
        detached: detached,
        leaderTravels: leaderTravels,
    };
};
