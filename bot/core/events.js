// =====================================================================
// bot_events – live events and world bosses (leader decides, team follows).
//
// Live state comes from server.status: every entry whose key is a G.events
// event or a G.monsters boss and that is not marked live:false counts as
// live. Seasonal events (type "seasonal") count only with policy "always".
//
// Policy per name in config.events.policy: "always" | "never" (default).
//   join events  (G.events[name].join) -> join(name); every member joins too
//   world bosses (server.status gives map/x/y) -> travel there, fight it
//   roaming bosses (config.events.search, e.g. phoenix) -> the leader walks
//     the spawn areas from G.maps every few minutes; a boss that shows up
//     while farming is engaged right away
// Cooperative monsters reward every contributor, so they may be attacked
// even while they fight other players.
// =====================================================================

module.exports = function createEvents(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const party = ctx.party;
    const cfg = config.events;
    const leads = !party.isMember;

    let lastLiveKey = "";
    let boss = null;           // { name, seenAt } – roaming boss currently engaged
    let searching = false;
    // boss -> timestamp; kept across restarts so a reload doesn't send the leader
    // searching right after a kill.
    const SEARCH_KEY = "dmpx_boss_search:" + character.name;
    const nextSearchAt = (function () {
        let stored = {};
        try { stored = get(SEARCH_KEY) || {}; } catch (e) { /* storage unavailable */ }
        // A boss just put on farmBosses still carried the old searchEveryMs time from storage,
        // so the nonstop hunt started up to 30 min late (2026-11-18): cut it to farmBossEveryMs.
        (cfg.farmBosses || []).forEach(function (name) {
            const soon = Date.now() + (cfg.farmBossEveryMs || 60 * 1000);
            if ((stored[name] || 0) > soon) stored[name] = soon;
        });
        return stored;
    })();
    // Bosses on config.events.farmBosses are hunted nonstop: the next search comes after
    // farmBossEveryMs instead of searchEveryMs (the Phoenix respawns ~32 s after its death).
    function searchLater(name) {
        const nonstop = (cfg.farmBosses || []).includes(name);
        nextSearchAt[name] = Date.now() + (nonstop ? (cfg.farmBossEveryMs || 60 * 1000) : cfg.searchEveryMs);
        try { set(SEARCH_KEY, nextSearchAt); } catch (e) { /* storage unavailable */ }
    }
    // Respawn-aware searching (player decision 2026-11-20, idea from earthiverse's bot): after a
    // kill we watched, a boss that respawns slowly is searched again only when it can be back -
    // at kill + respawn x respawnFactor (the game's long respawns come up to 28 % early). Jr
    // (7.2 h) and Green Jr (14.4 h) were searched every 30 min for hours. Never sooner than
    // searchEveryMs; the Phoenix (32 s) and anything not seen dying keep the normal timer.
    // The kill comes from the game's "death" message; the listener lives on the game page and
    // is swapped on each load (like the hit log).
    const PAGE = parent;
    try {
        if (PAGE.__dmpxDeathFn) PAGE.socket.off("death", PAGE.__dmpxDeathFn);
        PAGE.__dmpxDeaths = PAGE.__dmpxDeaths || {};
        PAGE.__dmpxDeathFn = function (d) {
            try {
                if (!d || !d.id) return;
                const now = Date.now();
                PAGE.__dmpxDeaths[d.id] = now;
                Object.keys(PAGE.__dmpxDeaths).forEach(function (id) { if (now - PAGE.__dmpxDeaths[id] > 10 * 60 * 1000) delete PAGE.__dmpxDeaths[id]; });
            } catch (e) { /* bookkeeping only */ }
        };
        PAGE.socket.on("death", PAGE.__dmpxDeathFn);
    } catch (e) { /* no socket */ }
    function killedAt(id) {
        if (!id) return 0;
        const e = parent.entities && parent.entities[id];
        if (e && e.dead) return Date.now();
        return (PAGE.__dmpxDeaths && PAGE.__dmpxDeaths[id]) || 0;
    }
    function respawnLater(name, killAt) {
        const resp = (G.monsters[name] && G.monsters[name].respawn) || 0;
        if (resp <= 200) {
            util.log("event", name + " killed - back to farming", "green");
            searchLater(name);
            return;
        }
        const back = killAt + resp * 1000 * (cfg.respawnFactor || 0.72);
        nextSearchAt[name] = Math.max(back, Date.now() + cfg.searchEveryMs);
        try { set(SEARCH_KEY, nextSearchAt); } catch (e) { /* storage unavailable */ }
        const h = (nextSearchAt[name] - Date.now()) / 3600000;
        util.log("event", name + " killed - next search in " + (h >= 1 ? h.toFixed(1) + " h" : Math.round(h * 60) + " min") + " (respawn " + Math.round(resp / 60) + " min)", "green");
    }
    let lastJoinTry = 0;
    let joined = null;         // leader: { name, map } once we stand on the event map
    let joining = null;        // leader: { name, from, at } while a join() is on its way

    function teamLevel() {
        return util.teamLevel(config);
    }

    // ---- boss check -----------------------------------------------------------
    // The guide never calls a boss safe ("group" monster), and other players are
    // rarely around, so the leader judges a boss itself from everyone's stats
    // (members report them every minute), with the game's damage formula:
    //   burst:   every fighter survives config.events.boss.minHits hits
    //   healing: the boss's damage per second on the tank is covered by the
    //            priests' healing (potions may add healCover - 1 on top)
    //   time:    the team alone kills it within maxFightMinutes (if set)
    // A death while fighting a boss pauses it for pauseAfterDeathMs (persisted).
    const bcfg = cfg.boss || {};
    // The members' stats survive a restart of the leader (player decision 2026-11-20): members
    // report only every 60 s, and until then the boss check said "waiting for the team's stats" -
    // a Phoenix in sight was left alone for up to a minute. Stored copies up to 30 min old count
    // as fresh right after the start (teamStats takes reports up to 3 min); new reports replace them.
    const STATS_KEY = "dmpx_team_stats:" + character.name;
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
    const PAUSE_KEY = "dmpx_boss_pause:" + character.name;
    const paused = (function () { try { return get(PAUSE_KEY) || {}; } catch (e) { return {}; } })();
    const verdicts = {};             // boss -> { ok, why, at }

    ctx.comms.on("stats", function (data, from) {
        if (!config.characters[from] || !data || !data.max_hp) return;
        stats[from] = { s: data, at: Date.now() };
        try { set(STATS_KEY, stats); } catch (e) { /* storage unavailable */ }
    });

    function shareStats() {
        if (leads || Date.now() - lastStatsSent < 60 * 1000) return;
        lastStatsSent = Date.now();
        ctx.comms.send(config.leader, "stats", util.combatStats());
    }

    function teamStats() {
        const list = [util.combatStats()];
        const now = Date.now();
        Object.keys(stats).forEach(function (name) {
            if (party.inParty(name) && now - stats[name].at < 3 * 60 * 1000) list.push(stats[name].s);
        });
        return list;
    }

    function assessBoss(name) {
        const m = G.monsters[name];
        const team = teamStats();
        const expected = config.team.fighters.filter(function (f) { return f === character.name || party.inParty(f); }).length;
        if (team.length < expected) return { ok: false, why: "waiting for the team's stats" };
        const minHits = bcfg.minHits || 6;
        const hitOn = function (f) {
            const def = m.damage_type === "physical" ? (f.armor || 0) - (m.apiercing || 0) : (f.resistance || 0) - (m.rpiercing || 0);
            return m.attack * 1.1 * util.damageMultiplier(def);
        };
        // 1. Burst: every fighter survives minHits hits.
        for (const f of team) {
            const hits = f.max_hp / hitOn(f);
            if (hits < minHits) return { ok: false, why: f.name + " survives only " + hits.toFixed(1) + " hits (need " + minHits + ")" };
        }
        // 2. Healing vs. damage on the tank: a warrior/paladin in the party (Taunt keeps the
        // boss on it), else the leader.
        const tankClasses = (config.targeting.teamSafety && config.targeting.teamSafety.tankClasses) || ["warrior", "paladin"];
        const tank = team.filter(function (f) { return tankClasses.includes(f.ctype); })
            .sort(function (a, b) { return b.max_hp - a.max_hp; })[0] || team[0];
        const incoming = hitOn(tank) * (m.frequency || 1);
        let healing = team.reduce(function (sum, f) {
            return sum + (f.ctype === "priest" ? (f.heal || f.attack) * f.frequency : 0);
        }, 0);
        // Alone (solo phase, Lone Wolf): potions and own sustain instead of a priest.
        if (team.length === 1 && healing === 0) healing = bcfg.soloSustainHps || 150;
        const cover = bcfg.healCover || 1.5;
        if (incoming > healing * cover) {
            return { ok: false, why: Math.round(incoming) + " damage/s on " + tank.name + " vs " + Math.round(healing) + " healing/s" };
        }
        // 3. Kill time with the team alone (priests mostly heal).
        const dps = team.reduce(function (sum, f) {
            const physical = f.damage_type === "physical";
            const def = physical ? (m.armor || 0) - (f.apiercing || 0) : (m.resistance || 0) - (f.rpiercing || 0);
            const hitChance = Math.max(0.1, 1 - (physical ? (m.evasion || 0) : (m.reflection || 0)) / 100);
            const share = f.ctype === "priest" ? (bcfg.priestDamageShare || 0.3) : 1;
            return sum + (f.attack || 0) * (f.frequency || 1) * util.damageMultiplier(def) * hitChance * share;
        }, 0);
        const minutes = m.hp / Math.max(1, dps) / 60;
        const max = bcfg.maxFightMinutes; // null: no time limit
        if (max && minutes > max) return { ok: false, why: "the team needs ~" + Math.round(minutes) + " min to kill it (max " + max + ")" };
        return { ok: true, why: "~" + Math.round(minutes) + " min, " + Math.round(incoming) + " damage/s vs " + Math.round(healing) + " healing/s" };
    }

    // Cached for a minute; logs when the verdict changes.
    function canBeat(name) {
        if (paused[name] > Date.now()) return false;
        const v = verdicts[name];
        if (v && Date.now() - v.at < 60 * 1000) return v.ok;
        const r = assessBoss(name);
        if (!v || v.ok !== r.ok) util.log("event", name + (r.ok ? " looks doable: " : " not doable yet: ") + r.why, r.ok ? "green" : "white");
        verdicts[name] = { ok: r.ok, why: r.why, at: Date.now() };
        return r.ok;
    }

    // Leader: a death while fighting a boss pauses that boss.
    function watchBossDeaths() {
        if (!leads || !current || current.join || !current.monster || !G.monsters[current.monster]) return;
        const dead = [character.name].concat(party.memberNames()).find(function (n) {
            const p = n === character.name ? character : get_player(n);
            return p && p.rip;
        });
        if (!dead || paused[current.monster] > Date.now()) return;
        paused[current.monster] = Date.now() + (bcfg.pauseAfterDeathMs || 3 * 60 * 60 * 1000);
        try { set(PAUSE_KEY, paused); } catch (e) { /* storage unavailable */ }
        util.log("event", dead + " died fighting " + current.monster + " - pausing it for " +
            Math.round((bcfg.pauseAfterDeathMs || 3 * 60 * 60 * 1000) / 3600000) + " h", "red");
        boss = null;
    }

    const skippedForLevel = {};
    // "always" only counts once every fighter reaches the event's minimum level and,
    // for a boss monster, once the boss check says the team can beat it.
    function policy(name) {
        const p = (cfg.policy && cfg.policy[name]) || "never";
        const min = (cfg.minLevel && cfg.minLevel[name]) || 0;
        if (p === "always" && teamLevel() < min) {
            if (!skippedForLevel[name]) {
                skippedForLevel[name] = true;
                util.log("event", name + " needs level " + min + " for everyone - skipping for now", "white");
            }
            return "never";
        }
        skippedForLevel[name] = false;
        if (p === "always" && G.monsters[name] && !(G.events[name] && G.events[name].join) && !canBeat(name)) return "never";
        return p;
    }

    function liveEntries() {
        const status = (typeof server !== "undefined" && server.status) || {};
        const list = [];
        Object.keys(status).forEach(function (name) {
            const s = status[name];
            if (!s || typeof s !== "object") return;
            const ev = G.events[name];
            const isBoss = !!G.monsters[name];
            if (!ev && !isBoss) return;
            // Seasonal events (e.g. Halloween's Graveyard Rising) only when the policy says "always".
            if (ev && ev.type === "seasonal" && (cfg.policy || {})[name] !== "always") return;
            if (s.live === false || s.active === false) return;
            list.push({ name: name, join: !!(ev && ev.join), map: s.map, x: s.x, y: s.y, boss: isBoss });
        });
        return list;
    }

    function observe(list) {
        if (!cfg.observe) return;
        const key = list.map(function (e) { return e.name; }).sort().join(",");
        if (key === lastLiveKey) return;
        lastLiveKey = key;
        if (list.length) {
            util.log("event", "live now: " + list.map(function (e) {
                return e.name + (e.map ? " @" + e.map : "") + " [" + policy(e.name) + "]";
            }).join(", "), "yellow");
        }
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

    // The leader's wait for the team (fighter.waitForTeam) is going on: marked every waiting tick.
    function teamWaiting() {
        return !!ctx.teamWaitAt && Date.now() - ctx.teamWaitAt < 1500;
    }

    // Any target boss in sight ends a search at once (player decision 2026-11-20): the search
    // only looked for its own boss - a Phoenix met on the way to Dracul's spot, or Dracul next
    // to the Phoenix in the cave, was walked past. Returns the visible boss's name or null.
    function visibleBoss() {
        return (cfg.search || []).find(function (n) {
            return (get_nearest_monster({ type: n }) || memberSighting(n)) && policy(n) === "always";
        }) || null;
    }
    let searchAbort = null; // name of the boss in sight that stopped the running search

    // Boss sightings shared by the members (player decision 2026-11-20): warrior and ranger saw
    // the Phoenix and walked to it, the priest (leader) did not see it and stood waiting for them
    // until it came into his own sight. Members report a target boss in their sight every 2 s;
    // the leader engages it like one he sees himself and walks to the reported spot.
    const sightings = {};      // leader: boss -> { id, map, x, y, from, at }
    let lastSightingSent = 0;
    ctx.comms.on("bosssight", function (data, from) {
        if (!leads || !data || !data.name || !(cfg.search || []).includes(data.name)) return;
        if (!sightings[data.name] || Date.now() - sightings[data.name].at > 30 * 1000) {
            util.log("event", data.name + " seen by " + from + " (" + data.map + ")", "green");
        }
        sightings[data.name] = { id: data.id, map: data.map, x: data.x, y: data.y, from: from, at: Date.now() };
    });
    function reportSightings() {
        if (leads || Date.now() - lastSightingSent < 2000) return;
        (cfg.search || []).some(function (name) {
            const m = get_nearest_monster({ type: name });
            if (!m) return false;
            lastSightingSent = Date.now();
            ctx.comms.send(config.leader, "bosssight", { name: name, id: m.id, map: character.map, x: Math.round(m.x), y: Math.round(m.y) });
            return true;
        });
    }
    // A member's fresh sighting (10 s) of a boss that is not known dead, or null.
    function memberSighting(name) {
        const s = sightings[name];
        if (!s || Date.now() - s.at > 10 * 1000 || killedAt(s.id)) return null;
        return s;
    }
    async function searchBoss(name) {
        searching = true;
        searchAbort = null;
        // Ends the search when a boss came into sight (tick() saw it and stopped the walk).
        const aborted = function () {
            if (!searchAbort) return false;
            util.log("event", searchAbort + " in sight - " + (searchAbort === name ? "found" : "search for " + name + " paused"), "green");
            if (searchAbort === name) searchLater(name); // found: the next search counts from now
            return true;
        };
        try {
            util.log("event", "searching " + name, "yellow");
            const spots = spawnSpots(name);
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
                        await smart_move(spot);
                        reached = true;
                    } catch (e) {
                        const reason = util.errReason(e);
                        if (aborted()) return; // a boss came into sight: fight it first
                        // Stopped by the leader's wait for the team (player decision 2026-11-20): no
                        // failed try - wait along, then walk on to the same spot. A Jr. search ended
                        // "not found" after three such stops without ever reaching his spot. Bounded
                        // by the wait's own limit (party.waitMaxMs) and 5 min per spot.
                        if (teamWaiting() && Date.now() - walkStart < 5 * 60 * 1000) {
                            while (teamWaiting()) await sleep(500);
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
                    boss = { name: name, seenAt: Date.now() };
                    searchLater(name); // next search counts from now (survives a restart)
                    util.log("event", name + " found on " + character.map, "green");
                    return;
                }
            }
            searchLater(name);
            util.log("event", name + " not found - next search in " + Math.max(1, Math.round((nextSearchAt[name] - Date.now()) / 60000)) + " min", "white");
        } catch (e) {
            util.log("event", "search for " + name + " failed: " + util.errReason(e), "red");
            searchLater(name);
        } finally {
            searching = false;
        }
    }

    // What the team should do right now, or null (then hunts/farming go on).
    //   { name, join: true }                  -> fight anything in the event map
    //   { name, monster, dest }               -> fight `monster`, travel to dest
    let current = null;

    function decide() {
        const list = liveEntries();
        observe(list);

        const live = list.find(function (e) { return policy(e.name) === "always"; });
        if (live) {
            if (live.join) return { name: live.name, join: true };
            const dest = live.map ? { map: live.map, x: live.x, y: live.y } : live.name;
            return { name: live.name, monster: live.boss ? live.name : null, dest: dest };
        }

        // Roaming bosses: engaged while visible (or seen in the last 30 s).
        (cfg.search || []).forEach(function (name) {
            const ok = policy(name) === "always";
            const seen = ok ? get_nearest_monster({ type: name }) : null;
            const told = ok && !seen ? memberSighting(name) : null;
            if (seen || told) {
                // Engaged: the next search is due searchEveryMs from now (stored), so a
                // restart right after the kill does not send us searching at once.
                if (!boss || boss.name !== name) searchLater(name);
                boss = seen
                    ? { name: name, seenAt: Date.now(), id: seen.id }
                    : { name: name, seenAt: told.at, id: told.id, dest: { map: told.map, x: told.x, y: told.y } };
            }
        });
        if (boss && Date.now() - boss.seenAt < 30 * 1000 && !killedAt(boss.id)) return { name: boss.name, monster: boss.name, dest: boss.dest || boss.name, sighted: true };
        if (boss) {
            const killed = killedAt(boss.id);
            if (killed) respawnLater(boss.name, killed);
            else {
                util.log("event", boss.name + " gone - back to farming", "white");
                searchLater(boss.name);
            }
            boss = null;
        }
        return null;
    }

    // Called every fighter tick. Returns "busy" while travelling/joining/searching.
    function tick() {
        if (!cfg.enabled) return "ok";
        shareStats();
        watchBossDeaths();
        reportSightings();
        if (searching) {
            // A target boss in sight (the searched one or another): stop the walk, fight it.
            if (leads && !searchAbort) {
                const seen = visibleBoss();
                if (seen) {
                    searchAbort = seen;
                    try { stop(); } catch (e) { /* not walking */ }
                }
            }
            return "busy";
        }

        if (!leads) {
            // Members join the leader's event (an event map can't be walked into).
            const lead = party.leaderInfo();
            const ev = lead && lead.event;
            if (ev && ev.join && character.map !== lead.map) {
                if (Date.now() - lastJoinTry > 10000) {
                    lastJoinTry = Date.now();
                    join(ev.name).catch(function (e) { util.log("event", "join " + ev.name + ": " + util.errReason(e), "orange"); });
                }
                return "busy";
            }
            current = ev || null;
            return "ok";
        }

        current = decide();

        // Join events: join once, re-join if we left the event map (e.g. after a death).
        // join() resolves before the teleport lands, so the event map is the first map
        // we reach after joining – not the map we were on when the promise resolved.
        if (!current || !current.join) {
            joined = null;
            joining = null;
        } else {
            if (joining && joining.name === current.name && character.map !== joining.from) {
                joined = { name: current.name, map: character.map };
                joining = null;
                util.log("event", "in " + current.name + " (" + character.map + ")", "green");
            }
            if (joined && joined.name === current.name && character.map !== joined.map) joined = null;
            // Already there (e.g. after a restart): event maps carry the event's name.
            if (!joined && !joining && character.map === current.name) joined = { name: current.name, map: character.map };
            if (!joined) {
                // Give a sent join time to land before trying again; a failed one waits 10 s.
                if (joining ? Date.now() - joining.at > 30000 : Date.now() - lastJoinTry > 10000) {
                    const name = current.name;
                    joining = { name: name, from: character.map, at: Date.now() };
                    util.log("event", "joining " + name, "green");
                    join(name).catch(function (e) {
                        util.log("event", "join " + name + ": " + util.errReason(e), "orange");
                        joining = null;
                        lastJoinTry = Date.now();
                    });
                }
                return "busy";
            }
        }
        if (!current) {
            const due = (cfg.search || []).find(function (name) {
                return policy(name) === "always" && Date.now() >= (nextSearchAt[name] || 0);
            });
            if (due) {
                searchBoss(due);
                return "busy";
            }
        }
        return "ok";
    }

    return {
        tick: tick,
        current: function () { return current; },
        // A roaming boss is in sight (ours or a member's): the leader goes to it, no team wait.
        // Checked live: the team wait runs before tick(), so `current` stays stale while waiting
        // (2026-11-20: the priest waited 45 s for the warrior with the Phoenix reported).
        engaging: function () { return !!(current && current.sighted) || (leads && !!visibleBoss()); },
        teamStats: teamStats, // leader: own stats + fresh member reports
    };
};
