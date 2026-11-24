// =====================================================================
// encounters/boss-search.js - searching bosses: when (respawn-aware), where (spawn areas, split between the members, the merchant scout), the runner, the search walks.
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
    const SEARCH_KEY = "bot_boss_search:" + character.name;
    const rcfg = cfg.runner || {};
    const scfg = cfg.scout || {};

    // Roaming bosses we fight when one is in sight (ours or a member's): the searched ones plus
    // config.events.engage - not searched any more, still taken when met (player decision 2026-11-21).
    function watched() {
        const out = (cfg.search || []).slice();
        (cfg.engage || []).forEach(function (n) { if (!out.includes(n)) out.push(n); });
        return out;
    }
    function runnerBosses() { return rcfg.enabled ? Object.keys(rcfg.bosses || {}) : []; }
    function everyMs(name) {
        return (rcfg.enabled && rcfg.bosses && rcfg.bosses[name]) || cfg.searchEveryMs;
    }
    function scoutAvailable() {
        if (!leads || !scfg.enabled || !config.merchant) return false;
        if (Date.now() - evs.scoutAvail.at < 2000) return evs.scoutAvail.ok;
        let ok = false, st = {};
        try {
            const m = config.merchant;
            const b = get("bot_beat:" + m);
            const here = parent.server_region + " " + parent.server_identifier;
            st = get("bot_scout:" + m) || {};
            ok = !!b && Date.now() - b.at < (scfg.freshMs || 90 * 1000) && b.server === here && !b.rip &&
                !get("bot_ponty_round:" + m) && !get("bot_trade_trip:" + m) && !((st.pausedUntil || 0) > Date.now());
        } catch (e) { ok = false; }
        evs.scoutAvail = { at: Date.now(), ok: ok, st: st };
        return ok;
    }
    // The merchant takes this boss now (not the runner, not the team).
    function scoutTakes(name) {
        if (!(scfg.bosses || []).includes(name) || !scoutAvailable()) return false;
        // On its round with this boss: still its job (a round can take longer than the fallback time).
        const st = evs.scoutAvail.st || {};
        if (st.state === "out" && (st.bosses || []).includes(name) && Date.now() - (st.at || 0) < (scfg.lapMaxMs || 15 * 60 * 1000)) return true;
        const due = evs.nextSearchAt[name] || 0;
        return !due || Date.now() - due < (scfg.fallbackMs || 10 * 60 * 1000);
    }
    function publishScoutPlan() {
        if (!leads || !scfg.enabled) return;
        const due = evs.cipherActive() ? [] : (scfg.bosses || []).filter(function (n) {
            return evs.policy(n) === "always" && Date.now() >= (evs.nextSearchAt[n] || 0) && scoutTakes(n) && !(evs.current && evs.current.monster === n);
        });
        const key = due.join(",");
        if (key === evs.planSent.key && Date.now() - evs.planSent.at < 10 * 1000) return;
        evs.planSent = { at: Date.now(), key: key };
        try { set("bot_scout_plan", { at: Date.now(), leader: character.name, server: parent.server_region + " " + parent.server_identifier, due: due }); } catch (e) { /* storage unavailable */ }
    }

    // Bosses on config.events.farmBosses are hunted nonstop: the next search comes after
    // farmBossEveryMs instead of searchEveryMs (the Phoenix respawns ~32 s after its death).
    function searchLater(name) {
        const nonstop = (cfg.farmBosses || []).includes(name);
        evs.nextSearchAt[name] = Date.now() + (nonstop ? (cfg.farmBossEveryMs || 60 * 1000) : everyMs(name));
        try { set(SEARCH_KEY, evs.nextSearchAt); } catch (e) { /* storage unavailable */ }
    }
    function respawnLater(name, killAt) {
        const resp = (G.monsters[name] && G.monsters[name].respawn) || 0;
        if (resp <= 200) {
            util.log("event", name + " killed - back to farming", "green");
            searchLater(name);
            return;
        }
        const back = killAt + resp * 1000 * (cfg.respawnFactor || 0.72);
        evs.nextSearchAt[name] = Math.max(back, Date.now() + everyMs(name));
        try { set(SEARCH_KEY, evs.nextSearchAt); } catch (e) { /* storage unavailable */ }
        const h = (evs.nextSearchAt[name] - Date.now()) / 3600000;
        util.log("event", name + " killed - next search in " + (h >= 1 ? h.toFixed(1) + " h" : Math.round(h * 60) + " min") + " (respawn " + Math.round(resp / 60) + " min)", "green");
    }

    // Spawn areas of a roaming boss, as points to visit.
    function spawnSpots(name) {
        const spots = [];
        Object.keys(G.maps).forEach(function (mapName) {
            const map = G.maps[mapName];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pack) {
                if (pack.type !== name) return;
                (pack.boundaries || []).forEach(function (b) {
                    spots.push({ map: b[0], x: Math.round((b[1] + b[3]) / 2), y: Math.round((b[2] + b[4]) / 2) });
                });
                if (pack.boundary) {
                    const b = pack.boundary;
                    spots.push({ map: mapName, x: Math.round((b[0] + b[2]) / 2), y: Math.round((b[1] + b[3]) / 2) });
                }
            });
        });
        return spots;
    }
    function splitAreas(name, spots) {
        evs.split = null;
        const fighters = (config.team && config.team.fighters) || [];
        const helpers = cfg.splitSearch === false || !party.enabled ? [] : fighters.filter(function (n) { return n !== character.name && party.inParty(n); });
        if (!helpers.length || spots.length < 2) return spots;
        const here = { x: character.real_x, y: character.real_y };
        const order = spots.slice().sort(function (a, b) {
            const da = a.map === character.map ? Math.hypot(a.x - here.x, a.y - here.y) : 1e6, db = b.map === character.map ? Math.hypot(b.x - here.x, b.y - here.y) : 1e6;
            return da - db;
        });
        const who = [character.name].concat(helpers);
        const jobs = {};
        who.forEach(function (n) { jobs[n] = []; });
        order.forEach(function (sp, i) { jobs[who[i % who.length]].push(sp); });
        const id = Date.now() + ":" + name;
        evs.split = { id: id, name: name, members: helpers.filter(function (n) { return jobs[n].length; }), pending: [] };
        evs.split.members.forEach(function (n) { deps.comms.send(n, "searchjob", { id: id, name: name, spots: jobs[n] }); });
        evs.split.pending = evs.split.members.slice();
        util.log("event", "split search: " + who.map(function (n) { return n + " " + jobs[n].length; }).join(", ") + " area(s)", "white");
        return jobs[character.name];
    }
    function endRunner() {
        if (evs.runnerJob) evs.lastRunner = { who: evs.runnerJob.who, at: Date.now() };
        evs.runnerJob = null;
    }
    function isHealer(ctype) { return !!(G.skills.heal && (G.skills.heal.class || []).includes(ctype)); }
    // The runner, wherever it is (null: none in the party). Player decision 2026-11-21 (replaces "the
    // fastest"): a tank must stay at the spot (booboos, mummies, aggressive packs need one). Order:
    //   1. ranged fighters (not in combat.melee.classes), the fastest
    //   2. melee fighters that are no tank (teamSafety.tankClasses), the fastest
    //   3. a tank only while another tank stays (two or more in the party), the fastest
    // Never the leader (the team follows it) or a healer (heal skill).
    function runnerCandidate() {
        const fighters = (config.team && config.team.fighters) || [];
        const info = get_party() || {};
        const melee = ((config.targeting && config.targeting.melee) || {}).classes || ["warrior", "paladin", "rogue"];
        const tanks = ((config.targeting && config.targeting.teamSafety) || {}).tankClasses || ["warrior", "paladin"];
        const members = fighters.filter(function (n) { return n !== character.name && party.inParty(n) && info[n]; });
        const cands = members.filter(function (n) {
            if (isHealer(info[n].type)) return false;
            const p = get_player(n);
            if (p) evs.speedOf[n] = p.speed;
            return !(p && p.rip) && !info[n].rip;
        });
        const fastest = function (list) { return list.sort(function (a, b) { return (evs.speedOf[b] || 0) - (evs.speedOf[a] || 0); })[0] || null; };
        const ranged = cands.filter(function (n) { return !melee.includes(info[n].type); });
        if (ranged.length) return fastest(ranged);
        const nonTank = cands.filter(function (n) { return !tanks.includes(info[n].type); });
        if (nonTank.length) return fastest(nonTank);
        const tankCount = fighters.filter(function (n) { return (n === character.name ? tanks.includes(character.ctype) : !!(info[n] && party.inParty(n) && tanks.includes(info[n].type))); }).length;
        return tankCount >= 2 ? fastest(cands) : null;
    }
    // `anywhere`: the nonstop runner gets its next job wherever it is (it never comes back to us).
    function pickRunner(anywhere) {
        const first = runnerCandidate();
        if (!first || anywhere) return first;
        const p = get_player(first);
        return p && util.distanceTo(p) <= ((config.party && config.party.waitDistance) || 500) ? first : null;
    }
    // Nonstop boss with a runner (player decision 2026-11-21): a boss on farmBosses is hunted nonstop
    // by the runner alone - it never calls the team, the others farm on (the old solo warrior got many
    // fire weapons and essences that way). Only while the runner can beat it alone (canSolo), else
    // the team searches it as usual. Returns the runner's name or null.
    function nonstopRunner(name) {
        if (!rcfg.enabled || !party.enabled || !(cfg.farmBosses || []).includes(name)) return null;
        const who = runnerCandidate();
        return who && evs.canSolo(name, who) ? who : null;
    }
    function nonstopActive() {
        return (cfg.farmBosses || []).map(function (n) { return nonstopRunner(n); }).find(Boolean) || null;
    }
    function startRunner(name) {
        const nonstop = !!nonstopRunner(name);
        const who = pickRunner(nonstop || !!nonstopActive());
        if (!who) return false;
        const spots = spawnSpots(name);
        if (!spots.length) { searchLater(name); return false; }
        const id = Date.now() + ":" + name;
        const solo = nonstop || (rcfg.solo || []).includes(name);
        const killMs = nonstop ? (rcfg.nonstopKillMs || 15 * 60 * 1000) : (rcfg.killMs || 3 * 60 * 1000);
        evs.runnerJob = { id: id, name: name, who: who, at: Date.now(), nonstop: nonstop };
        deps.comms.send(who, "searchjob", { id: id, name: name, spots: spots, solo: solo, nonstop: nonstop, killMs: killMs });
        util.log("event", who + " searches " + name + " alone (" + spots.length + " area(s), " + (nonstop ? "nonstop, " : "") +
            (solo ? "kills it alone" : "the team comes when found") + ") - the others farm on", "yellow");
        return true;
    }
    // Leader: a runner that never reports back (left the party, stuck) is given up after maxMs.
    // Not confirmed within 15 s (2026-11-21: the first job went out a second before the ranger's
    // code was running): dropped and sent again on the next tick.
    function checkRunner() {
        if (evs.runnerJob && !evs.runnerJob.acked && Date.now() - evs.runnerJob.at > 15 * 1000) {
            util.log("event", evs.runnerJob.who + " did not take the " + evs.runnerJob.name + " search - sending it again", "orange");
            endRunner();
            return;
        }
        const max = evs.runnerJob && evs.runnerJob.nonstop ? (rcfg.nonstopMaxMs || 20 * 60 * 1000) : (rcfg.maxMs || 8 * 60 * 1000);
        if (!evs.runnerJob || Date.now() - evs.runnerJob.at < max) return;
        util.log("event", evs.runnerJob.who + " did not report back from the " + evs.runnerJob.name + " search - giving up on it", "orange");
        deps.comms.send(evs.runnerJob.who, "searchstop", { id: evs.runnerJob.id });
        searchLater(evs.runnerJob.name);
        endRunner();
    }
    async function runJob(j) {
        let found = null;
        try {
            // Nearest area first (a nonstop lap starts wherever the last fight ended).
            const here = { x: character.real_x, y: character.real_y };
            const order = j.spots.slice().sort(function (a, b) {
                const da = a.map === character.map ? Math.hypot(a.x - here.x, a.y - here.y) : 1e6, db = b.map === character.map ? Math.hypot(b.x - here.x, b.y - here.y) : 1e6;
                return da - db;
            });
            for (const spot of order) {
                if (j.stop) return;
                util.status("searching " + j.name + " (" + spot.map + ")", "yellow");
                for (let t = 0; t < 3 && !j.stop; t++) {
                    try { await util.viaFirst(spot); await smart_move(spot); break; } catch (e) { if (get_nearest_monster({ type: j.name })) break; await sleep(1500); }
                }
                if (j.stop) return;
                if (get_nearest_monster({ type: j.name })) break;
                await sleep(cfg.searchSpotMs);
                if (get_nearest_monster({ type: j.name })) break;
            }
            found = get_nearest_monster({ type: j.name });
            if (found && j.solo && !j.stop) {
                // Solo boss: tick() fights it now (current = this boss), searchdone follows the kill.
                j.kill = { id: found.id, at: Date.now() };
                util.log("event", j.name + " found " + evs.infoText(evs.bossInfo(j.name, found)) + " - killing it alone, the team farms on", "green");
                return;
            }
            if (found) util.log("event", j.name + " found " + evs.infoText(evs.bossInfo(j.name, found)) + " - " + (holdsFor(j.name) ? "holding until the team is here" : "the team comes"), "green");
            if (found && !j.stop) evs.heldFind = { name: j.name, until: Date.now() + 60 * 1000 }; // wait at it (v1.235.9)
        } catch (e) {
            util.log("event", "search for " + j.name + " failed: " + util.errReason(e), "orange");
        } finally {
            if (!j.kill) {
                if (!j.stop) deps.comms.send(config.leader, "searchdone", { id: j.id, found: !!found });
                if (evs.job === j) evs.job = null;
            }
        }
    }
    function holdsFor(name) { return cfg.holdForTeam !== false || (cfg.holdFor || []).includes(name); }
    // Member, solo boss of a runner job: fight it while it is in sight (killMs at most), then report.
    function soloKill() {
        const m = get_nearest_monster({ type: evs.job.name });
        if (m && !m.dead && !evs.job.stop && Date.now() - evs.job.kill.at < (evs.job.killMs || rcfg.killMs || 3 * 60 * 1000)) {
            evs.current = { name: evs.job.name, monster: evs.job.name, dest: { map: character.map, x: Math.round(m.x), y: Math.round(m.y) }, solo: true };
            return true;
        }
        const killed = evs.killedAt(evs.job.kill.id);
        util.log("event", evs.job.name + (killed ? " killed alone" : " gone or not killed in time") + " after " + Math.round((Date.now() - evs.job.kill.at) / 1000) + " s - back to the team", killed ? "green" : "white");
        if (!evs.job.stop) deps.comms.send(config.leader, "searchdone", { id: evs.job.id, found: true, alone: true, killed: killed || 0 });
        evs.job = null;
        evs.current = null;
        return false;
    }

    async function searchBoss(name) {
        evs.searching = true;
        evs.searchAbort = null;
        // Ends the search when a boss came into sight (tick() saw it and stopped the walk).
        const aborted = function () {
            if (!evs.searchAbort) return false;
            util.log("event", evs.searchAbort + " in sight - " + (evs.searchAbort === name ? "found" : "search for " + name + " paused"), "green");
            if (evs.searchAbort === name) searchLater(name); // found: the next search counts from now
            return true;
        };
        try {
            util.log("event", "searching " + name, "yellow");
            const all = spawnSpots(name);
            const spots = splitAreas(name, all); // our own share when the team searches in parallel
            for (let si = 0; si < spots.length; si++) {
                if (aborted()) return;
                const spot = spots[si];
                util.status("searching " + name + " (" + spot.map + ")", "yellow");
                // Every spawn area in the log, so a skipped one shows up (2026-11-17).
                util.log("event", name + ": area " + (si + 1) + "/" + spots.length + " " + spot.map + " " + spot.x + "," + spot.y, "white");
                // Stopped on the way (the handover to the merchant at his stand stands us
                // still) is no reason to skip a spawn area: walk on to the same spot again.
                // Dracul's first area was skipped that way (2026-11-17).
                let reached = false;
                let attempt = 0;
                const walkStart = Date.now();
                while (attempt < 3 && !reached) {
                    try {
                        await util.viaFirst(spot);
                        await smart_move(spot);
                        reached = true;
                    } catch (e) {
                        const reason = util.errReason(e);
                        if (aborted()) return; // a boss came into sight: fight it first
                        // Stopped by the leader's wait for the team (player decision 2026-11-20): no
                        // failed try - wait along, then walk on to the same spot. A Jr. search ended
                        // "not found" after three such stops without ever reaching his spot. Bounded
                        // by the wait's own limit (party.waitMaxMs) and 5 min per spot.
                        if (evs.teamWaiting() && Date.now() - walkStart < 5 * 60 * 1000) {
                            while (evs.teamWaiting()) await sleep(500);
                            util.status("searching " + name + " (" + spot.map + ")", "yellow"); // the wait's status is over
                            continue;
                        }
                        attempt++;
                        if (/interrupt|stop/i.test(reason) && attempt < 3) { await sleep(1500); continue; }
                        util.log("event", "can't reach " + spot.map + " (" + reason + ") - next spot", "orange");
                        break;
                    }
                }
                if (aborted()) return;
                if (!reached) continue;
                await sleep(cfg.searchSpotMs);
                if (aborted()) return;
                if (get_nearest_monster({ type: name })) {
                    evs.boss = { name: name, seenAt: Date.now() };
                    searchLater(name); // next search counts from now (survives a restart)
                    util.log("event", name + " found on " + character.map, "green");
                    return;
                }
            }
            // Parallel search: wait for the members' areas (they report searchdone) or a sighting.
            if (evs.split) {
                const until = Date.now() + (cfg.splitWaitMs || 4 * 60 * 1000);
                while (evs.split.pending.length && Date.now() < until) {
                    if (evs.searchAbort || evs.visibleBoss()) { evs.searchAbort = evs.searchAbort || evs.visibleBoss(); if (aborted()) return; }
                    util.status("searching " + name + " - waiting for " + evs.split.pending.join(", "), "yellow");
                    await sleep(1000);
                }
            }
            searchLater(name);
            util.log("event", name + " not found - next search in " + Math.max(1, Math.round((evs.nextSearchAt[name] - Date.now()) / 60000)) + " min", "white");
        } catch (e) {
            util.log("event", "search for " + name + " failed: " + util.errReason(e), "red");
            searchLater(name);
        } finally {
            evs.searching = false;
            if (evs.split) { deps.comms.send(evs.split.members, "searchstop", { id: evs.split.id }); evs.split = null; }
        }
    }

    Object.assign(evs, {
        watched: watched,
        runnerBosses: runnerBosses,
        everyMs: everyMs,
        scoutAvailable: scoutAvailable,
        scoutTakes: scoutTakes,
        publishScoutPlan: publishScoutPlan,
        searchLater: searchLater,
        respawnLater: respawnLater,
        spawnSpots: spawnSpots,
        splitAreas: splitAreas,
        endRunner: endRunner,
        isHealer: isHealer,
        runnerCandidate: runnerCandidate,
        pickRunner: pickRunner,
        nonstopRunner: nonstopRunner,
        nonstopActive: nonstopActive,
        startRunner: startRunner,
        checkRunner: checkRunner,
        runJob: runJob,
        searchBoss: searchBoss,
        holdsFor: holdsFor,
        soloKill: soloKill,
    });
};
