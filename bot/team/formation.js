// =====================================================================
// team/formation.js - the leader waits for the team, a hurt member walks into the healer's range, a healer leader covers members under attack.
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

    function endWaitStatus() {
        if (!ftr.waitShown) return;
        ftr.waitShown = false;
        util.status("walking on", "white");
    }
    function waitForTeam() {
        const pc = config.party || {};
        if (!party.enabled || !party.isLeader || !pc.waitForTeam) return false;
        // Never while a fight is on - a monster on us or on any member: the waiting skipped the
        // priest's heals while the warrior died to mummies and the ranger was off buying potions
        // (2026-11-19).
        const members = party.memberNames();
        if (Object.values(parent.entities || {}).some(function (e) {
            return e && e.type === "monster" && !e.dead && e.target && (e.target === character.name || members.includes(e.target));
        })) { endWaitStatus(); return false; }
        // A target boss in sight (ours or a member's): the members are already at it, the leader
        // goes there too instead of waiting for them (2026-11-20, Phoenix at the armadillos).
        if (deps.events && deps.events.engaging && deps.events.engaging()) { ftr.teamWaitSince = 0; endWaitStatus(); return false; }
        // On a route: no stops on the way - the members walk to its end themselves and we wait there
        // (player decision 2026-11-21, idea from earthiverse: the priest stopped at almost every door).
        if (pc.goToDest !== false && typeof smart !== "undefined" && smart.moving) { ftr.teamWaitSince = 0; endWaitStatus(); return false; }
        // Parallel boss search: the members walk their own areas (2026-11-21).
        if (deps.events && deps.events.splitSearching && deps.events.splitSearching()) { ftr.teamWaitSince = 0; endWaitStatus(); return false; }
        const fighters = (config.team && config.team.fighters) || [];
        const runner = deps.events && deps.events.runnerOut ? deps.events.runnerOut() : null; // out on a boss search alone
        // A member that went ahead and stands at our farm spot already is not waited for (2026-11-21:
        // the priest waited in town for the warrior, who was at the giant scorpions long since).
        let spot = null;
        try { spot = ftr.lastFarm && ftr.lastFarm.monster && targeting.spotFor ? targeting.spotFor(ftr.lastFarm.monster, ftr.lastFarm.map) : null; } catch (e) { spot = null; }
        const atSpot = function (info) {
            return !!(spot && info && info.map === spot.map && typeof info.x === "number" &&
                Math.hypot(info.x - spot.x, info.y - spot.y) <= (pc.waitDistance || 500));
        };
        // ...nor one already at our NEXT goal (2026-11-22, player report): on the waypoint map (halloween) the members
        // went ahead to the door, the priest stopped at the entrance to wait for them, they walked back to it - and so
        // on at every leg. Our next goal: the farm spot through the waypoint rule (e.g. halloween's spookytown door).
        let next = null;
        try { next = ftr.lastFarm && ftr.lastFarm.monster ? ftr.viaFor(ftr.goalFor(ftr.lastFarm)) : null; } catch (e) { next = null; }
        const atNext = function (info) {
            return !!(next && typeof next === "object" && next.map && typeof next.x === "number" && info && info.map === next.map &&
                typeof info.x === "number" && Math.hypot(info.x - next.x, info.y - next.y) <= (pc.waitDistance || 500));
        };
        // A member strong enough to pick its own targets here (targeting isEasy, from its own stats) farms on
        // its own like a detached one - no waiting for it (player decision 2026-11-21: the warrior took his own
        // CGoos far away and priest and ranger stood waiting for him).
        const stats = deps.teamStats ? deps.teamStats.teamStats() : [];
        const ownTargets = function (n) {
            const s = config.party.spread, def = ftr.lastFarm && ftr.lastFarm.monster && G.monsters[ftr.lastFarm.monster];
            const st = stats.find(function (x) { return x && x.name === n; });
            if (!s || !s.enabled || !def || def.cooperative || !st) return false;
            if (s.harmlessRatio && def.attack <= st.max_hp * s.harmlessRatio) return true;
            const risk = util.kiteRisk(def, null, { speed: st.speed, range: st.range }); // kiteable: residual risk (2026-11-21)
            if (risk < 1) return def.attack * risk <= st.max_hp * s.maxDamageRatio;
            return def.hp <= st.attack * s.maxHits && def.attack <= st.max_hp * s.maxDamageRatio;
        };
        const far = party.memberNames().filter(function (n) {
            if (n === character.name || !fighters.includes(n) || n === runner) return false;
            if (ownTargets(n)) return false;
            const info = (get_party() || {})[n] || {};
            if (character.map !== (spot && spot.map) && atSpot(info)) return false; // ahead of us, at the spot
            if (atNext(info)) return false; // ahead of us, at our next goal
            if (ftr.lastFarm && ftr.lastFarm.monster && util.tooSpiky(config, ftr.lastFarm.monster, info.type)) return false; // farms on its own
            const p = get_player(n);
            if (p && p.rip) return false;
            return !p || util.distanceTo(p) > (pc.waitDistance || 500);
        });
        if (!far.length) { ftr.teamWaitSince = 0; endWaitStatus(); return false; }
        const now = Date.now();
        if (!ftr.teamWaitSince) {
            ftr.teamWaitSince = now;
            util.log("party", "waiting for " + far.join(", "), "white");
        }
        // Waited long enough: go on for waitAgainMs, then wait again (2026-11-18: after one long
        // wait the leader never waited again and walked alone to the next spot).
        const waited = now - ftr.teamWaitSince, max = pc.waitMaxMs || 45000;
        if (waited > max + (pc.waitAgainMs || 60000)) {
            ftr.teamWaitSince = now;
            util.log("party", "waiting for " + far.join(", ") + " again", "white");
        } else if (waited > max) { endWaitStatus(); return false; }
        // Marked for the boss search: a walk stopped by this wait is no failed try (2026-11-20).
        ftr.teamWaitAt = now;
        if (is_moving(character)) { ftr.walks.stopOnPurpose(); stop(); }
        util.status("waiting for " + far.join(", "), "yellow");
        ftr.waitShown = true;
        return true;
    }
    function toHealer() {
        const pc = config.party || {};
        if (!party.enabled || party.isLeader || !pc.toHealerBelow || util.hpRatio() >= pc.toHealerBelow || character.ctype === "priest") return false;
        const healer = party.memberNames().map(function (n) { return n === character.name ? null : get_player(n); })
            .find(function (p) { return p && !p.rip && util.isHealer(p); });
        if (!healer) return false;
        const reach = (healer.range || 200) * 0.8;
        if (util.distanceTo(healer) <= reach) return false;
        util.status("to " + healer.name + " for heals", "orange");
        if (Date.now() - ftr.toHealerAt > 500) {
            ftr.toHealerAt = Date.now();
            const p = util.xy(healer);
            try { Promise.resolve(xmove(p.x, p.y)).catch(function () {}); } catch (e) { /* next tick */ }
        }
        return true;
    }
    function coverMembers() {
        if (!party.enabled || !party.isLeader) return false;
        const heal = G.skills.heal;
        if (!heal || !(heal.class || []).includes(character.ctype)) return false;
        let worst = null;
        party.memberNames().forEach(function (n) {
            if (n === character.name) return;
            const p = get_player(n);
            if (!p || p.rip || p.map !== character.map) return;
            const hit = Object.values(parent.entities || {}).some(function (e) { return e && e.type === "monster" && !e.dead && e.target === n; });
            if (!hit) return;
            const d = util.distanceTo(p);
            if (d > (character.range || 200) * 0.95 && (!worst || d > worst.d)) worst = { p: p, d: d };
        });
        if (!worst) return false;
        util.status("covering " + worst.p.name, "yellow");
        // Only into heal range (85 %), not onto the member (2026-11-21: the priest kited the
        // Phoenix to 90 % of its range, walked onto the warrior next to it at 80 %, and so on).
        // A straight line: walk to that point. Behind a wall: a path to the member itself (walkable),
        // through moveTo, which does not restart a running path search every 0.7 s - the priest stood
        // "covering" off the giant scorpion spot while each new order cut the search off (2026-11-21).
        if (Date.now() - ftr.coverMoveAt > 700) {
            ftr.coverMoveAt = Date.now();
            const me = util.xy(character), to = util.xy(worst.p);
            const f = 1 - (character.range || 200) * 0.85 / Math.max(1, worst.d);
            const x = me.x + (to.x - me.x) * f, y = me.y + (to.y - me.y) * f;
            if (can_move_to(x, y)) { ftr.moveDest = { x: x, y: y }; quiet(move(x, y)); }
            else ftr.moveTo(to);
        }
        return true;
    }

    Object.assign(ftr, {
        endWaitStatus: endWaitStatus,
        waitForTeam: waitForTeam,
        toHealer: toHealer,
        coverMembers: coverMembers,
    });
};
