// =====================================================================
// bot_events – live events and world bosses (leader decides, team follows).
//
// Live state comes from server.status: every entry whose key is a G.events
// event or a G.monsters boss and that is not marked live:false counts as
// live. Seasons (type "seasonal") are not activities and are ignored.
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
    const nextSearchAt = {};   // boss -> timestamp
    let lastJoinTry = 0;
    let joined = null;         // leader: { name, map } after a successful join()

    function teamLevel() {
        return util.teamLevel(config);
    }

    const skippedForLevel = {};
    // "always" only counts once every fighter reaches the event's minimum level.
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
            if (ev && ev.type === "seasonal") return;
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

    async function searchBoss(name) {
        searching = true;
        try {
            util.log("event", "searching " + name, "yellow");
            for (const spot of spawnSpots(name)) {
                util.status("searching " + name + " (" + spot.map + ")", "yellow");
                try {
                    await smart_move(spot);
                } catch (e) {
                    util.log("event", "can't reach " + spot.map + " (" + util.errReason(e) + ") - next spot", "orange");
                    continue;
                }
                await sleep(cfg.searchSpotMs);
                if (get_nearest_monster({ type: name })) {
                    boss = { name: name, seenAt: Date.now() };
                    util.log("event", name + " found on " + character.map, "green");
                    return;
                }
            }
            util.log("event", name + " not found - next search in " + Math.round(cfg.searchEveryMs / 60000) + " min", "white");
            nextSearchAt[name] = Date.now() + cfg.searchEveryMs;
        } catch (e) {
            util.log("event", "search for " + name + " failed: " + util.errReason(e), "red");
            nextSearchAt[name] = Date.now() + cfg.searchEveryMs;
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
            if (policy(name) === "always" && get_nearest_monster({ type: name })) boss = { name: name, seenAt: Date.now() };
        });
        if (boss && Date.now() - boss.seenAt < 30 * 1000) return { name: boss.name, monster: boss.name, dest: boss.name };
        if (boss) {
            util.log("event", boss.name + " gone - back to farming", "white");
            nextSearchAt[boss.name] = Date.now() + cfg.searchEveryMs;
            boss = null;
        }
        return null;
    }

    // Called every fighter tick. Returns "busy" while travelling/joining/searching.
    function tick() {
        if (!cfg.enabled) return "ok";
        if (searching) return "busy";

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
        if (!current || !current.join) {
            joined = null;
        } else {
            if (joined && joined.name === current.name && character.map !== joined.map) joined = null;
            if (!joined) {
                if (Date.now() - lastJoinTry > 10000) {
                    lastJoinTry = Date.now();
                    const name = current.name;
                    util.log("event", "joining " + name, "green");
                    join(name)
                        .then(function () { joined = { name: name, map: character.map }; })
                        .catch(function (e) { util.log("event", "join " + name + ": " + util.errReason(e), "orange"); });
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
    };
};
