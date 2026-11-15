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
            event: event ? { name: event.name, join: !!event.join, monster: event.monster || null } : null,
        });
    }

    // Fresh leader info for members, or null.
    function leaderInfo() {
        if (!enabled || isLeader || !leaderState) return null;
        if (Date.now() - leaderState.at > 15000) return null;
        return leaderState;
    }

    function moveTowards(point, label) {
        util.status(label, "yellow");
        if (is_moving(character)) return;
        if (character.map !== point.map) {
            smart_move({ map: point.map, x: point.x, y: point.y }).catch(function () {});
        } else {
            xmove(point.x, point.y);
        }
    }

    // Members: hard leash. Returns true when we must move instead of fighting.
    function keepUp() {
        const lead = leaderInfo();
        if (!lead) return false;
        if (character.map !== lead.map || util.distanceTo(lead) > cfg.leash) {
            moveTowards(lead, "following " + leader);
            return true;
        }
        return false;
    }

    // Members without a target: stay close to the leader. Without a fresh
    // broadcast (e.g. right after a restart) use the leader if it is visible,
    // otherwise wait where we are – never wander off alone.
    function idleFollow() {
        if (!enabled || isLeader) return false;
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
        if (util.distanceTo(lead) > cfg.followDistance) moveTowards(lead, "following " + leader);
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
    };
};
