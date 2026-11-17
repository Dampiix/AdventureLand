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
        try { return get(SEARCH_KEY) || {}; } catch (e) { return {}; }
    })();
    // Bosses on config.events.farmBosses are hunted nonstop: the next search comes after
    // farmBossEveryMs instead of searchEveryMs (the Phoenix respawns ~32 s after its death).
    function searchLater(name) {
        const nonstop = (cfg.farmBosses || []).includes(name);
        nextSearchAt[name] = Date.now() + (nonstop ? (cfg.farmBossEveryMs || 60 * 1000) : cfg.searchEveryMs);
        try { set(SEARCH_KEY, nextSearchAt); } catch (e) { /* storage unavailable */ }
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
    const stats = {};                // fighter -> { s, at }
    let lastStatsSent = 0;
    const PAUSE_KEY = "dmpx_boss_pause:" + character.name;
    const paused = (function () { try { return get(PAUSE_KEY) || {}; } catch (e) { return {}; } })();
    const verdicts = {};             // boss -> { ok, why, at }

    ctx.comms.on("stats", function (data, from) {
        if (config.characters[from] && data && data.max_hp) stats[from] = { s: data, at: Date.now() };
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

    async function searchBoss(name) {
        searching = true;
        try {
            util.log("event", "searching " + name, "yellow");
            for (const spot of spawnSpots(name)) {
                util.status("searching " + name + " (" + spot.map + ")", "yellow");
                // Stopped on the way (the handover to the merchant at his stand stands us
                // still) is no reason to skip a spawn area: walk on to the same spot again.
                // Dracul's first area was skipped that way (2026-11-17).
                let reached = false;
                for (let attempt = 0; attempt < 3 && !reached; attempt++) {
                    try {
                        await smart_move(spot);
                        reached = true;
                    } catch (e) {
                        const reason = util.errReason(e);
                        if (/interrupt|stop/i.test(reason) && attempt < 2) { await sleep(1500); continue; }
                        util.log("event", "can't reach " + spot.map + " (" + reason + ") - next spot", "orange");
                        break;
                    }
                }
                if (!reached) continue;
                await sleep(cfg.searchSpotMs);
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
            if (policy(name) === "always" && get_nearest_monster({ type: name })) {
                // Engaged: the next search is due searchEveryMs from now (stored), so a
                // restart right after the kill does not send us searching at once.
                if (!boss || boss.name !== name) searchLater(name);
                boss = { name: name, seenAt: Date.now() };
            }
        });
        if (boss && Date.now() - boss.seenAt < 30 * 1000) return { name: boss.name, monster: boss.name, dest: boss.name };
        if (boss) {
            util.log("event", boss.name + " gone - back to farming", "white");
            searchLater(boss.name);
            boss = null;
        }
        return null;
    }

    // Called every fighter tick. Returns "busy" while travelling/joining/searching.
    function tick() {
        if (!cfg.enabled) return "ok";
        shareStats();
        watchBossDeaths();
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
        teamStats: teamStats, // leader: own stats + fresh member reports
    };
};
