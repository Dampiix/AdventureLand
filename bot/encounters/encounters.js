// =====================================================================
// encounters/encounters.js - the per-tick flow of events and bosses: decide what the team does now, join events, our own death in a fight.
// Part of bot_events (module plan, stage 4c): moved verbatim from the old single-file core/events.js. The parts
// share one internal state (evs: the current event, searches, runners, sightings) and call each other through evs;
// outside dependencies come in deps (game, util, config, comms, party, cave, bus, teamStats).
// =====================================================================

module.exports = function install(evs, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const cfg = config.events;
    const leads = !party.isMember;
    const rcfg = cfg.runner || {};
    const shareStats = deps.teamStats.shareStats;

    // The leader's wait for the team (fighter.waitForTeam) is going on: marked every waiting tick.
    function teamWaiting() {
        const at = deps.bus.get("teamWaitAt"); // fighter: when the leader last waited for the team
        return !!at && Date.now() - at < 1500;
    }
    // Own death on a solo fight (fighter.handleDeath): tell the leader - it pauses the boss.
    function onOwnDeath() {
        if (leads || !evs.job || !evs.job.kill) return;
        util.log("event", "died fighting " + evs.job.name + " alone", "red");
        deps.comms.send(config.leader, "searchdone", { id: evs.job.id, died: true });
        evs.job.stop = true;
        evs.job = null;
    }

    // Where the team goes for a member's sighting: the finder's own spot (walkable, within sight of
    // the boss), not the boss itself - a Phoenix over unwalkable ground gave "Path not found!" on
    // every try, and the priest and the ranger stood still (2026-11-21). Old reports: the boss.
    function walkTo(told) {
        const ok = told.fx !== undefined && told.fy !== undefined;
        return { map: told.map, x: ok ? told.fx : told.x, y: ok ? told.fy : told.y };
    }

    function decide() {
        const list = evs.liveEntries();
        evs.observe(list);

        const live = list.find(function (e) { return evs.policy(e.name) === "always"; });
        if (live) {
            if (live.join) return { name: live.name, join: true };
            const dest = live.map ? { map: live.map, x: live.x, y: live.y } : live.name;
            return { name: live.name, monster: live.boss ? live.name : null, dest: dest };
        }

        // Roaming bosses: engaged while visible (or seen in the last 30 s). One at a time: while the
        // boss we are at is alive and was seen within 30 s, only that one counts; another boss in
        // sight waits until it is done (2026-11-21: with the Phoenix and Dracul both in the cave the
        // event flipped between them every tick - the warrior switched targets, the journal filled
        // with "in my sight" and every flip restarted the other boss's search timer).
        // Witch's Cipher gathering window: no roaming bosses (2026-11-23, player decision - the 20 minutes count fully).
        if (evs.cipherActive()) {
            if (evs.boss) { util.log("event", evs.boss.name + " left alone - Witch's Cipher gathering", "white"); evs.boss = null; }
            return null;
        }
        const holding = evs.boss && Date.now() - evs.boss.seenAt < 30 * 1000 && !evs.killedAt(evs.boss.id);
        // The boss we had is done - killed, or out of sight for 30 s: booked (journal, next search) before another one
        // replaces it (v1.236.1, player report 2026-11-24: Ms. Dracul died while the merchant's Skeletor report waited -
        // the Skeletor took her place at once, and her kill was never booked: no journal line, no respawn timing).
        const endBoss = function () {
            if (!evs.boss) return;
            const killed = evs.killedAt(evs.boss.id);
            evs.outcome(evs.boss, killed ? "killed" : "gone without a kill seen");
            if (killed) evs.respawnLater(evs.boss.name, killed);
            else {
                util.log("event", evs.boss.name + " gone - back to farming", "white");
                evs.searchLater(evs.boss.name);
            }
            evs.boss = null;
        };
        const oldKilled = evs.boss ? evs.killedAt(evs.boss.id) : 0;
        // Without a current boss (e.g. after a restart) one that already fights one of us comes first
        // (2026-11-21: Dracul at 5 % on the warrior, the event went to the fresh Phoenix next to it).
        const ours = [character.name].concat(party.memberNames());
        const engaged = function (n) { const m = get_nearest_monster({ type: n }); return !!(m && m.target && ours.includes(m.target)); };
        const candidates = holding ? [evs.boss.name] : evs.watched().slice().sort(function (a, b) { return (engaged(b) ? 1 : 0) - (engaged(a) ? 1 : 0); });
        for (const name of candidates) {
            const ok = evs.policy(name) === "always";
            const seen = ok ? get_nearest_monster({ type: name }) : null;
            const told = ok && !seen ? evs.memberSighting(name) : null;
            if (seen || told) {
                // Engaged: the next search is due searchEveryMs from now (stored), so a
                // restart right after the kill does not send us searching at once.
                // The same boss again (not a fresh one of its kind after a kill): one fight, its first sighting kept.
                if (evs.boss && (evs.boss.name !== name || oldKilled)) endBoss();
                const prev = evs.boss && evs.boss.name === name ? evs.boss : null;
                if (!prev) evs.searchLater(name);
                const info = seen ? evs.bossInfo(name, seen) : told.info;
                evs.boss = seen
                    ? { name: name, seenAt: Date.now(), id: seen.id }
                    : { name: name, seenAt: told.scout ? Date.now() : told.at, id: told.id, dest: walkTo(told) }; // a held scout report counts as seen now
                evs.boss.first = prev && prev.first ? prev.first : { at: Date.now(), info: info };
                evs.boss.info = info || (prev && prev.info) || null;
                if (!prev && seen) util.log("event", name + " in my sight " + evs.infoText(info), "green");
                break;
            }
        }
        if (evs.boss && Date.now() - evs.boss.seenAt < 30 * 1000 && !evs.killedAt(evs.boss.id)) return { name: evs.boss.name, monster: evs.boss.name, dest: evs.boss.dest || evs.boss.name, sighted: true };
        endBoss();
        return null;
    }

    // Called every fighter tick. Returns "busy" while travelling/joining/searching.
    function tick() {
        if (!cfg.enabled) return "ok";
        shareStats();
        evs.watchBossDeaths();
        evs.reportSightings();
        // Every tick, also while we search or fight (v1.220.4: the plan went stale during the leader's own search,
        // and the merchant stopped its round after 66 s).
        evs.publishScoutPlan();
        if (evs.searching) {
            // A target boss in sight (the searched one or another): stop the walk, fight it.
            if (leads && !evs.searchAbort) {
                const seen = evs.visibleBoss();
                if (seen) {
                    evs.searchAbort = seen;
                    try { stop(); } catch (e) { /* not walking */ }
                }
            }
            return "busy";
        }

        if (!leads && evs.job && evs.job.kill && evs.soloKill()) return "ok"; // runner: fighting its solo boss (current)
        // Another team boss in sight on the way (2026-11-21: the runner saw the Phoenix in main on its way
        // to Dracul, reported it and walked on - the team came, the Phoenix was gone): stop the job and
        // stay at it - the leader engages it from our report; the job's boss is searched again after it.
        if (!leads && evs.job && !evs.job.kill) {
            const other = evs.watched().find(function (n) { return n !== evs.job.name && !(rcfg.solo || []).includes(n) && get_nearest_monster({ type: n }); });
            if (other) {
                util.log("event", other + " in sight - stopping the " + evs.job.name + " search", "green");
                const j = evs.job;
                j.stop = true;
                evs.job = null;
                deps.comms.send(config.leader, "searchdone", { id: j.id, found: false, interrupted: other });
                try { stop(); } catch (e) { /* not walking */ }
            }
        }
        if (!leads && evs.job) return "busy"; // walking our share of a parallel boss search
        if (!leads) {
            // Members join the leader's event (an event map can't be walked into).
            const lead = party.leaderInfo();
            const ev = lead && lead.event;
            if (ev && ev.join && character.map !== lead.map) {
                if (Date.now() - evs.lastJoinTry > 10000) {
                    evs.lastJoinTry = Date.now();
                    join(ev.name).catch(function (e) { util.log("event", "join " + ev.name + ": " + util.errReason(e), "orange"); });
                }
                return "busy";
            }
            evs.current = ev || null;
            // A boss we just found as the runner (v1.235.9, player report 2026-11-24): until the leader's event arrives
            // we treat it as ours and wait at it - the mage blinked back towards the priest after reporting Dracul and
            // only then came again. Ends with the leader's event, when the boss is out of sight, or after 60 s.
            if (!evs.current && evs.heldFind && Date.now() < evs.heldFind.until) {
                const b = get_nearest_monster({ type: evs.heldFind.name });
                if (b && !b.dead) evs.current = { name: evs.heldFind.name, monster: evs.heldFind.name, held: true };
                else evs.heldFind = null;
            } else if (evs.current) evs.heldFind = null;
            return "ok";
        }

        evs.current = decide();

        // Join events: join once, re-join if we left the event map (e.g. after a death).
        // join() resolves before the teleport lands, so the event map is the first map
        // we reach after joining – not the map we were on when the promise resolved.
        if (!evs.current || !evs.current.join) {
            evs.joined = null;
            evs.joining = null;
        } else {
            if (evs.joining && evs.joining.name === evs.current.name && character.map !== evs.joining.from) {
                evs.joined = { name: evs.current.name, map: character.map };
                evs.joining = null;
                util.log("event", "in " + evs.current.name + " (" + character.map + ")", "green");
            }
            if (evs.joined && evs.joined.name === evs.current.name && character.map !== evs.joined.map) evs.joined = null;
            // Already there (e.g. after a restart): event maps carry the event's name; events on a normal map
            // (events.joinSpot, the Giga Crab on main) count within its radius.
            const js = (cfg.joinSpot || {})[evs.current.name];
            const atSpot = !!js && character.map === js.map && Math.hypot(character.real_x - js.x, character.real_y - js.y) <= (js.r || 500);
            if (!evs.joined && !evs.joining && (character.map === evs.current.name || atSpot)) evs.joined = { name: evs.current.name, map: character.map };
            if (!evs.joined) {
                // Give a sent join time to land before trying again; a failed one waits 10 s.
                if (evs.joining ? Date.now() - evs.joining.at > 30000 : Date.now() - evs.lastJoinTry > 10000) {
                    const name = evs.current.name;
                    evs.joining = { name: name, from: character.map, at: Date.now() };
                    util.log("event", "joining " + name, "green");
                    join(name).catch(function (e) {
                        util.log("event", "join " + name + ": " + util.errReason(e), "orange");
                        evs.joining = null;
                        evs.lastJoinTry = Date.now();
                    });
                }
                return "busy";
            }
        }
        evs.checkRunner();
        // One search at a time: the team search waits while a runner is out, and the other way round. None during the
        // Witch's Cipher gathering window.
        if (!evs.current && !evs.runnerJob && !evs.cipherActive()) {
            // A nonstop boss with a runner is the runner's job, not the team's; a boss the merchant searches
            // (scoutTakes) is not the team's either.
            const due = (cfg.search || []).find(function (name) {
                return evs.policy(name) === "always" && Date.now() >= (evs.nextSearchAt[name] || 0) && !evs.nonstopRunner(name) && !evs.scoutTakes(name);
            });
            if (due) {
                evs.searchBoss(due);
                return "busy";
            }
            // Runner bosses: only from the farm spot (not on a route), so the runner starts from the team.
            // The other runner bosses come first when due, the nonstop one fills every gap.
            if (!(typeof smart !== "undefined" && smart.moving)) {
                const nonstop = (cfg.farmBosses || []).filter(function (n) { return !!evs.nonstopRunner(n); });
                const run = evs.runnerBosses().filter(function (n) { return !nonstop.includes(n); }).concat(nonstop).find(function (name) {
                    return evs.policy(name) === "always" && Date.now() >= (evs.nextSearchAt[name] || 0) && !evs.scoutTakes(name);
                });
                if (run) evs.startRunner(run);
            }
        }
        return "ok";
    }

    Object.assign(evs, {
        teamWaiting: teamWaiting,
        onOwnDeath: onOwnDeath,
        walkTo: walkTo,
        decide: decide,
        tick: tick,
    });
};
