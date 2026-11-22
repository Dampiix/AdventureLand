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
    // Roaming bosses we fight when one is in sight (ours or a member's): the searched ones plus
    // config.events.engage - not searched any more, still taken when met (player decision 2026-11-21).
    function watched() {
        const out = (cfg.search || []).slice();
        (cfg.engage || []).forEach(function (n) { if (!out.includes(n)) out.push(n); });
        return out;
    }
    // A runner boss has its own interval (config.events.runner.bosses), everything else searchEveryMs.
    const rcfg = cfg.runner || {};
    function runnerBosses() { return rcfg.enabled ? Object.keys(rcfg.bosses || {}) : []; }
    function everyMs(name) {
        return (rcfg.enabled && rcfg.bosses && rcfg.bosses[name]) || cfg.searchEveryMs;
    }
    // Bosses on config.events.farmBosses are hunted nonstop: the next search comes after
    // farmBossEveryMs instead of searchEveryMs (the Phoenix respawns ~32 s after its death).
    function searchLater(name) {
        const nonstop = (cfg.farmBosses || []).includes(name);
        nextSearchAt[name] = Date.now() + (nonstop ? (cfg.farmBossEveryMs || 60 * 1000) : everyMs(name));
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
        nextSearchAt[name] = Math.max(back, Date.now() + everyMs(name));
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

    // Every fighter tells every other one (2026-11-22, was: members to the leader only): the warrior's live
    // check (mobbing escape, protective Agitate) needs the priest's healing and the team's stats too.
    function shareStats() {
        if (!party.enabled || Date.now() - lastStatsSent < 60 * 1000) return;
        lastStatsSent = Date.now();
        const me = util.combatStats();
        config.team.fighters.forEach(function (n) {
            if (n !== character.name && party.inParty(n)) ctx.comms.send(n, "stats", me);
        });
    }

    function teamStats() {
        const list = [util.combatStats()];
        const now = Date.now();
        Object.keys(stats).forEach(function (name) {
            if (party.inParty(name) && now - stats[name].at < 3 * 60 * 1000) list.push(stats[name].s);
        });
        return list;
    }

    // `alone`: the stats of one fighter (a runner on its own) instead of the whole team.
    // `live` (optional): the boss as we see it - a grown one hits harder and has more HP
    // (2026-11-21, EU IV: a level-8 Phoenix with 720k HP and attack 250 at 1.47/s killed the warrior
    // alone while the level-1 numbers said "~1 min"). Kill time from its HP left.
    function assessBoss(name, alone, live) {
        const base = G.monsters[name];
        const m = live ? Object.assign({}, base, {
            attack: live.attack || base.attack, frequency: live.frequency || base.frequency,
            hp: live.hp || live.max_hp || base.hp,
        }) : base;
        const team = alone ? [alone] : teamStats();
        const expected = config.team.fighters.filter(function (f) { return f === character.name || party.inParty(f); }).length;
        if (!alone && team.length < expected) return { ok: false, why: "waiting for the team's stats" };
        const minHits = bcfg.minHits || 6;
        // Pure damage ignores armor and resistance; the learned hit factor counts as in the farm checks (2026-11-22 review).
        const hitOn = function (f) {
            return m.attack * 1.1 * util.hitMultiplier(f, m.damage_type, m) * util.hitFactor(name);
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
        // A fighter alone that can kite the boss (range >= boss range + kite margin like fighter.kiteStep, but
        // stricter on speed: the boss slower than 90 % of us, where the kite step takes up to maxSpeedRatio 0.99)
        // takes practically no lasting damage (player decision 2026-11-21); the burst check above still applies
        // for a kite gone wrong.
        const k = (config.combat && config.combat.kite) || {};
        const kites = !!alone && k.enabled !== false && (alone.range || 0) >= (m.range || 20) + (k.margin || 30) && Math.max(m.speed || 0, m.charge || 0) < (alone.speed || 0) * 0.9; // charge: Jr. rushes at 90 (2026-11-21)
        const incoming = kites ? 0 : hitOn(tank) * (m.frequency || 1);
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
            const def = util.defenseVs(m, f.damage_type, f);
            const hitChance = Math.max(0.1, 1 - (physical ? (m.evasion || 0) : (m.reflection || 0)) / 100);
            const share = f.ctype === "priest" ? (bcfg.priestDamageShare || 0.3) : 1;
            return sum + (f.attack || 0) * (f.frequency || 1) * util.damageMultiplier(def) * hitChance * share;
        }, 0);
        const minutes = m.hp / Math.max(1, dps) / 60;
        const max = bcfg.maxFightMinutes; // null: no time limit
        if (max && minutes > max) return { ok: false, why: "the team needs ~" + Math.round(minutes) + " min to kill it (max " + max + ")" };
        return { ok: true, why: "~" + Math.round(minutes) + " min, " + (kites ? "kiting it" : Math.round(incoming) + " damage/s vs " + Math.round(healing) + " healing/s") };
    }

    // Cached for a minute; logs when the verdict changes.
    // With the boss in sight its real level counts (cache per level).
    function canBeat(name) {
        if (paused[name] > Date.now()) return false;
        const seen = get_nearest_monster({ type: name });
        const lvl = seen ? (seen.level || 1) : 1;
        const key = name + ":" + lvl;
        const v = verdicts[key];
        if (v && Date.now() - v.at < 60 * 1000) return v.ok;
        const r = assessBoss(name, null, seen);
        const tag = lvl > 1 ? " (level " + lvl + ")" : "";
        if (!v || v.ok !== r.ok) util.log("event", name + tag + (r.ok ? " looks doable: " : " not doable yet: ") + r.why, r.ok ? "green" : "white");
        verdicts[key] = { ok: r.ok, why: r.why, at: Date.now() };
        return r.ok;
    }

    // Can I open on this boss on my own (player decision 2026-11-21)? Anyone may attack a boss alone -
    // unless it is too strong for us alone with its real level (burst, damage vs. own sustain;
    // kiting counts): then we hold it until the team is there (targeting.holdBoss), with the
    // healer the team always manages. Logged when the verdict changes.
    const soloSeen = {}; // "type:level" -> { ok, at }
    function soloOk(t) {
        if (!t || !G.monsters[t.mtype]) return true;
        const key = t.mtype + ":" + (t.level || 1);
        const c = soloSeen[key];
        if (c && Date.now() - c.at < 30 * 1000) return c.ok;
        const r = assessBoss(t.mtype, util.combatStats(), t);
        if (!c || c.ok !== r.ok) util.log("event", t.mtype + " level " + (t.level || 1) + (r.ok ? " - I can take it alone: " : " - too strong for me alone, holding for the team: ") + r.why, r.ok ? "green" : "white");
        soloSeen[key] = { ok: r.ok, at: Date.now() };
        return r.ok;
    }

    // A boss fight is on or about to start: one in our sight (any watched boss, paused or not), the
    // team's current boss event, or (leader) a fresh member sighting. No Daisy trips then
    // (player request 2026-11-21: the team walked to Daisy in the middle of a half-dead Phoenix).
    function bossBusy() {
        if (current && !current.join) return true;
        return watched().some(function (n) {
            const m = get_nearest_monster({ type: n });
            return (m && !m.dead) || (leads && !!memberSighting(n));
        });
    }

    // Can `who` (a runner) beat the boss alone? From its last reported stats; cached for a minute,
    // logged when the verdict changes. A pause after a death counts here too.
    function canSolo(name, who) {
        if (paused[name] > Date.now()) return false;
        const key = "solo:" + name + ":" + who;
        const v = verdicts[key];
        if (v && Date.now() - v.at < 60 * 1000) return v.ok;
        const s = stats[who] && Date.now() - stats[who].at < 30 * 60 * 1000 ? stats[who].s : null;
        const r = s ? assessBoss(name, s) : { ok: false, why: "no stats from " + who + " yet" };
        if (!v || v.ok !== r.ok) util.log("event", name + (r.ok ? " looks doable for " + who + " alone: " : " not doable for " + who + " alone: ") + r.why, r.ok ? "green" : "white");
        verdicts[key] = { ok: r.ok, why: r.why, at: Date.now() };
        return r.ok;
    }

    // Leader: a death while fighting a boss pauses that boss.
    let lastDeathNoPause = "";
    function watchBossDeaths() {
        if (!leads || !current || current.join || !current.monster || !G.monsters[current.monster]) return;
        const dead = [character.name].concat(party.memberNames()).find(function (n) {
            const p = n === character.name ? character : get_player(n);
            return p && p.rip;
        });
        if (!dead || paused[current.monster] > Date.now()) return;
        // Only a death AT the boss (player decision 2026-11-21): the warrior died to two Fire Roamers on
        // the way to a Phoenix the ranger had seen in the cave, and the Phoenix was paused for 3 h. The
        // boss must be in our sight within bossDeathRange of the dead one (fighting it, not walking to it).
        const deadP = dead === character.name ? character : get_player(dead);
        const bossNear = Object.values(parent.entities || {}).some(function (e) {
            return e && e.type === "monster" && e.mtype === current.monster && deadP &&
                Math.hypot((e.real_x || e.x) - (deadP.real_x || deadP.x), (e.real_y || e.y) - (deadP.real_y || deadP.y)) <= (bcfg.bossDeathRange || 600);
        });
        if (!bossNear) {
            if (lastDeathNoPause !== dead + "|" + current.monster) {
                lastDeathNoPause = dead + "|" + current.monster;
                util.log("event", dead + " died away from " + current.monster + " - not pausing it", "orange");
            }
            return;
        }
        lastDeathNoPause = "";
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
        return watched().find(function (n) {
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
    // Where and how we meet a boss (player request 2026-11-21: the Phoenix was often gone without our
    // kill - probably at spawn areas where other players farm). Into the journal with every sighting
    // and outcome: spawn area, HP, who fights it, other players near it.
    function ours() { return Object.keys(config.characters || {}); }
    function bossInfo(name, m) {
        const p = { x: Math.round(m.x), y: Math.round(m.y) };
        let area = null, best = Infinity;
        spawnSpots(name).forEach(function (s) {
            if (s.map !== character.map) return;
            const d = Math.hypot(s.x - p.x, s.y - p.y);
            if (d < best) { best = d; area = s.map + " " + s.x + "," + s.y; }
        });
        const own = ours();
        const others = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "character" && !e.npc && !own.includes(e.name) && Math.hypot(e.x - m.x, e.y - m.y) < 400;
        }).map(function (e) { return e.name; });
        return {
            map: character.map, x: p.x, y: p.y, area: area || character.map,
            hp: Math.round(100 * m.hp / Math.max(1, m.max_hp)),
            by: m.target && !own.includes(m.target) ? m.target : null,
            others: others.slice(0, 6),
        };
    }
    function infoText(i) {
        if (!i) return "";
        return "at " + i.map + " " + i.x + "," + i.y + " (area " + i.area + "), " + i.hp + " % HP" +
            (i.by ? ", fought by " + i.by : "") + ", others near: " + (i.others && i.others.length ? i.others.join(", ") : "none");
    }
    // Outcome line for a boss we engaged: how long after the first sighting, where, in what state.
    function outcome(b, what) {
        if (!b || !b.first) return;
        const s = Math.round((Date.now() - b.first.at) / 1000);
        util.log("event", b.name + " " + what + " " + s + " s after first sight - first " + infoText(b.first.info) +
            (b.info && b.info !== b.first.info ? "; last " + infoText(b.info) : ""), "white");
    }
    ctx.comms.on("bosssight", function (data, from) {
        if (!leads || !data || !data.name || !watched().includes(data.name)) return;
        // Nonstop mode: the runner met its nonstop boss by chance (no job) - it gets the job and kills
        // it alone, no team call (player decision 2026-11-21: the ranger found a Phoenix at the farm
        // spot and the whole team came).
        // Its own nonstop job's boss: never a team call (13:42Z: the job went out in the same second
        // as the runner's report, and the warrior came anyway).
        if (runnerJob && runnerJob.nonstop && runnerJob.who === from && runnerJob.name === data.name) return;
        if (!runnerJob && !current && nonstopRunner(data.name) === from) {
            util.log("event", data.name + " met by " + from + " - nonstop: " + from + " takes it alone", "yellow");
            if (startRunner(data.name)) return;
        }
        if (!sightings[data.name] || Date.now() - sightings[data.name].at > 30 * 1000) {
            util.log("event", data.name + " seen by " + from + " " + (data.info ? infoText(data.info) : "(" + data.map + ")"), "green");
        }
        sightings[data.name] = { id: data.id, map: data.map, x: data.x, y: data.y, fx: data.fx, fy: data.fy, from: from, at: Date.now(), info: data.info || null };
    });
    // Kills only a member sees (player request 2026-11-21): the leader counted a Phoenix the ranger
    // and nibe2 killed in the cave as "gone without a kill seen" (and searched it again on the
    // plain timer instead of the respawn rule) - it only knew deaths from its own game socket.
    // A member reports the death of a boss it reported; the leader books it like its own.
    ctx.comms.on("bossdeath", function (data, from) {
        if (!leads || !data || !data.id) return;
        try {
            PAGE.__dmpxDeaths = PAGE.__dmpxDeaths || {};
            if (!PAGE.__dmpxDeaths[data.id]) PAGE.__dmpxDeaths[data.id] = Math.min(Date.now(), data.at || Date.now());
        } catch (e) { /* bookkeeping only */ }
    });
    const reportedBoss = {}; // member: boss id -> { name, at } of our sightings, for the death report
    function reportBossDeaths() {
        const now = Date.now();
        Object.keys(reportedBoss).forEach(function (id) {
            const killed = killedAt(id);
            if (killed) {
                ctx.comms.send(config.leader, "bossdeath", { id: id, name: reportedBoss[id].name, at: killed });
                delete reportedBoss[id];
            } else if (now - reportedBoss[id].at > 10 * 60 * 1000) delete reportedBoss[id];
        });
    }
    function reportSightings() {
        if (leads) return;
        reportBossDeaths();
        if (Date.now() - lastSightingSent < 2000) return;
        watched().some(function (name) {
            // A runner kills its own solo boss alone - no call for the team (runner, 2026-11-21).
            if (job && job.solo && job.name === name) return false;
            if (nonstopUntil[name] > Date.now()) return false; // nonstop runner between two laps: no call either
            const m = get_nearest_monster({ type: name });
            if (!m) return false;
            lastSightingSent = Date.now();
            reportedBoss[m.id] = { name: name, at: Date.now() };
            // fx/fy: where we stand - walkable, unlike a Phoenix flying over a cliff (2026-11-21).
            ctx.comms.send(config.leader, "bosssight", { name: name, id: m.id, map: character.map, x: Math.round(m.x), y: Math.round(m.y), fx: Math.round(character.x), fy: Math.round(character.y), info: bossInfo(name, m) });
            return true;
        });
    }
    // A member's fresh sighting (10 s) of a boss that is not known dead, or null.
    function memberSighting(name) {
        const s = sightings[name];
        if (!s || Date.now() - s.at > 10 * 1000 || killedAt(s.id)) return null;
        return s;
    }
    // Parallel boss search (player decision 2026-11-21, from earthiverse): the leader splits the spawn
    // areas between the fighters in the party (nearest first, in turns); each walks its own and
    // reports a sighting (bosssight) - the team then meets there. Nobody opens the fight alone
    // (targeting holds an unengaged boss until the team is there).
    let split = null; // leader: { id, name, members, pending }
    function splitAreas(name, spots) {
        split = null;
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
        split = { id: id, name: name, members: helpers.filter(function (n) { return jobs[n].length; }), pending: [] };
        split.members.forEach(function (n) { ctx.comms.send(n, "searchjob", { id: id, name: name, spots: jobs[n] }); });
        split.pending = split.members.slice();
        util.log("event", "split search: " + who.map(function (n) { return n + " " + jobs[n].length; }).join(", ") + " area(s)", "white");
        return jobs[character.name];
    }
    ctx.comms.on("searchdone", function (data, from) {
        if (split && data && data.id === split.id) split.pending = split.pending.filter(function (n) { return n !== from; });
        if (runnerJob && data && data.id === runnerJob.id) {
            const name = runnerJob.name;
            endRunner();
            if (data.died) {
                // The runner died fighting it alone: pause the boss like a team death (pauseAfterDeathMs).
                paused[name] = Date.now() + (bcfg.pauseAfterDeathMs || 3 * 60 * 60 * 1000);
                try { set(PAUSE_KEY, paused); } catch (e) { /* storage unavailable */ }
                util.log("event", from + " died fighting " + name + " alone - pausing it for " + Math.round((bcfg.pauseAfterDeathMs || 3 * 60 * 60 * 1000) / 3600000) + " h", "red");
                searchLater(name);
            } else if (data.killed) respawnLater(name, data.killed);
            else if (data.interrupted && policy(data.interrupted) !== "always") {
                // A boss we don't take (paused after a death, too strong): no instant new job - the
                // runner stopped again at once, 30 jobs in 5 s next to a paused level-8 Phoenix
                // (2026-11-21). Searched again on the usual timer.
                searchLater(name);
                util.log("event", from + " stopped the " + name + " search for " + data.interrupted + ", which we leave alone now - next search in " +
                    Math.max(1, Math.round((nextSearchAt[name] - Date.now()) / 60000)) + " min", "white");
            } else if (data.interrupted && nonstopRunner(data.interrupted) === from) {
                // Stopped for its own nonstop boss: that job right away (no team call, no loop of the
                // old search being sent again and stopped again).
                util.log("event", from + " stopped the " + name + " search for " + data.interrupted + " - nonstop: it takes it alone", "yellow");
                startRunner(data.interrupted);
            } else if (data.interrupted) util.log("event", from + " stopped the " + name + " search for " + data.interrupted + " - searching it again after that", "white");
            else {
                searchLater(name);
                util.log("event", name + (data.alone ? " fought by " + from + " alone, no kill seen" : data.found ? " found by " + from + " - the team comes" : " not found by " + from) +
                    " - next search in " + Math.max(1, Math.round((nextSearchAt[name] - Date.now()) / 60000)) + " min", data.found ? "green" : "white");
            }
        }
    });

    // One runner per boss (player decision 2026-11-21): the leader sends one fighter to the spawn
    // areas of a runner boss while the rest of the team farms on. It kills a solo boss itself, a strong
    // one it reports (bosssight) and holds until the team is there when holdsFor says so
    // (events.holdForTeam or events.holdFor - both off / [] now).
    let runnerJob = null; // leader: { id, name, who, at }
    // The last runner walking back to us after its job: not waited for either (2026-11-21: the priest
    // stopped three times for the warrior on its way back from Dracul and Green Jr.).
    let lastRunner = null; // leader: { who, at }
    function endRunner() {
        if (runnerJob) lastRunner = { who: runnerJob.who, at: Date.now() };
        runnerJob = null;
    }
    // Speeds are remembered from when we last saw each fighter. The runner is only sent when it stands
    // near us; on its way back from the last job we wait for it, a dead or offline one is skipped
    // (2026-11-21: Green Jr. went to the second choice while the first walked back from Jr. - the
    // priest stood alone at the spot).
    const speedOf = {};
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
            if (p) speedOf[n] = p.speed;
            return !(p && p.rip) && !info[n].rip;
        });
        const fastest = function (list) { return list.sort(function (a, b) { return (speedOf[b] || 0) - (speedOf[a] || 0); })[0] || null; };
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
        return who && canSolo(name, who) ? who : null;
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
        runnerJob = { id: id, name: name, who: who, at: Date.now(), nonstop: nonstop };
        ctx.comms.send(who, "searchjob", { id: id, name: name, spots: spots, solo: solo, nonstop: nonstop, killMs: killMs });
        util.log("event", who + " searches " + name + " alone (" + spots.length + " area(s), " + (nonstop ? "nonstop, " : "") +
            (solo ? "kills it alone" : "the team comes when found") + ") - the others farm on", "yellow");
        return true;
    }
    ctx.comms.on("searchack", function (data, from) {
        if (runnerJob && data && data.id === runnerJob.id && from === runnerJob.who) runnerJob.acked = true;
    });
    // Leader: a runner that never reports back (left the party, stuck) is given up after maxMs.
    // Not confirmed within 15 s (2026-11-21: the first job went out a second before the ranger's
    // code was running): dropped and sent again on the next tick.
    function checkRunner() {
        if (runnerJob && !runnerJob.acked && Date.now() - runnerJob.at > 15 * 1000) {
            util.log("event", runnerJob.who + " did not take the " + runnerJob.name + " search - sending it again", "orange");
            endRunner();
            return;
        }
        const max = runnerJob && runnerJob.nonstop ? (rcfg.nonstopMaxMs || 20 * 60 * 1000) : (rcfg.maxMs || 8 * 60 * 1000);
        if (!runnerJob || Date.now() - runnerJob.at < max) return;
        util.log("event", runnerJob.who + " did not report back from the " + runnerJob.name + " search - giving up on it", "orange");
        ctx.comms.send(runnerJob.who, "searchstop", { id: runnerJob.id });
        searchLater(runnerJob.name);
        endRunner();
    }
    // Members: walk the areas the leader gave us, stop on its "searchstop" or when we see the boss.
    let job = null; // { id, name, spots, stop }
    const nonstopUntil = {}; // member: boss -> until when we count as its nonstop runner (no team call)
    // Own death on a solo fight (fighter.handleDeath): tell the leader - it pauses the boss.
    function onOwnDeath() {
        if (leads || !job || !job.kill) return;
        util.log("event", "died fighting " + job.name + " alone", "red");
        ctx.comms.send(config.leader, "searchdone", { id: job.id, died: true });
        job.stop = true;
        job = null;
    }
    ctx.comms.on("searchjob", function (data, from) {
        if (leads || from !== config.leader || !data || !Array.isArray(data.spots)) return;
        if (job) job.stop = true;
        job = { id: data.id, name: data.name, spots: data.spots, stop: false, solo: !!data.solo, kill: null, killMs: data.killMs || 0 };
        if (data.nonstop) nonstopUntil[data.name] = Date.now() + 3 * 60 * 1000;
        ctx.comms.send(config.leader, "searchack", { id: data.id });
        util.log("event", "searching " + data.name + " for the team: " + data.spots.map(function (s) { return s.map; }).join(", ") + (data.solo ? " (killing it alone)" : ""), "yellow");
        runJob(job);
    });
    ctx.comms.on("searchstop", function (data, from) {
        if (from !== config.leader || !job || (data && data.id && data.id !== job.id)) return;
        job.stop = true;
        job = null;
        try { stop(); } catch (e) { /* not walking */ }
    });
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
                util.log("event", j.name + " found " + infoText(bossInfo(j.name, found)) + " - killing it alone, the team farms on", "green");
                return;
            }
            if (found) util.log("event", j.name + " found " + infoText(bossInfo(j.name, found)) + " - " + (holdsFor(j.name) ? "holding until the team is here" : "the team comes"), "green");
        } catch (e) {
            util.log("event", "search for " + j.name + " failed: " + util.errReason(e), "orange");
        } finally {
            if (!j.kill) {
                if (!j.stop) ctx.comms.send(config.leader, "searchdone", { id: j.id, found: !!found });
                if (job === j) job = null;
            }
        }
    }
    function holdsFor(name) { return cfg.holdForTeam !== false || (cfg.holdFor || []).includes(name); }
    // Member, solo boss of a runner job: fight it while it is in sight (killMs at most), then report.
    function soloKill() {
        const m = get_nearest_monster({ type: job.name });
        if (m && !m.dead && !job.stop && Date.now() - job.kill.at < (job.killMs || rcfg.killMs || 3 * 60 * 1000)) {
            current = { name: job.name, monster: job.name, dest: { map: character.map, x: Math.round(m.x), y: Math.round(m.y) }, solo: true };
            return true;
        }
        const killed = killedAt(job.kill.id);
        util.log("event", job.name + (killed ? " killed alone" : " gone or not killed in time") + " after " + Math.round((Date.now() - job.kill.at) / 1000) + " s - back to the team", killed ? "green" : "white");
        if (!job.stop) ctx.comms.send(config.leader, "searchdone", { id: job.id, found: true, alone: true, killed: killed || 0 });
        job = null;
        current = null;
        return false;
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
            // Parallel search: wait for the members' areas (they report searchdone) or a sighting.
            if (split) {
                const until = Date.now() + (cfg.splitWaitMs || 4 * 60 * 1000);
                while (split.pending.length && Date.now() < until) {
                    if (searchAbort || visibleBoss()) { searchAbort = searchAbort || visibleBoss(); if (aborted()) return; }
                    util.status("searching " + name + " - waiting for " + split.pending.join(", "), "yellow");
                    await sleep(1000);
                }
            }
            searchLater(name);
            util.log("event", name + " not found - next search in " + Math.max(1, Math.round((nextSearchAt[name] - Date.now()) / 60000)) + " min", "white");
        } catch (e) {
            util.log("event", "search for " + name + " failed: " + util.errReason(e), "red");
            searchLater(name);
        } finally {
            searching = false;
            if (split) { ctx.comms.send(split.members, "searchstop", { id: split.id }); split = null; }
        }
    }

    // What the team should do right now, or null (then hunts/farming go on).
    //   { name, join: true }                  -> fight anything in the event map
    //   { name, monster, dest }               -> fight `monster`, travel to dest
    let current = null;

    // Where the team goes for a member's sighting: the finder's own spot (walkable, within sight of
    // the boss), not the boss itself - a Phoenix over unwalkable ground gave "Path not found!" on
    // every try, and the priest and the ranger stood still (2026-11-21). Old reports: the boss.
    function walkTo(told) {
        const ok = told.fx !== undefined && told.fy !== undefined;
        return { map: told.map, x: ok ? told.fx : told.x, y: ok ? told.fy : told.y };
    }

    function decide() {
        const list = liveEntries();
        observe(list);

        const live = list.find(function (e) { return policy(e.name) === "always"; });
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
        const holding = boss && Date.now() - boss.seenAt < 30 * 1000 && !killedAt(boss.id);
        // Without a current boss (e.g. after a restart) one that already fights one of us comes first
        // (2026-11-21: Dracul at 5 % on the warrior, the event went to the fresh Phoenix next to it).
        const ours = [character.name].concat(party.memberNames());
        const engaged = function (n) { const m = get_nearest_monster({ type: n }); return !!(m && m.target && ours.includes(m.target)); };
        const candidates = holding ? [boss.name] : watched().slice().sort(function (a, b) { return (engaged(b) ? 1 : 0) - (engaged(a) ? 1 : 0); });
        for (const name of candidates) {
            const ok = policy(name) === "always";
            const seen = ok ? get_nearest_monster({ type: name }) : null;
            const told = ok && !seen ? memberSighting(name) : null;
            if (seen || told) {
                // Engaged: the next search is due searchEveryMs from now (stored), so a
                // restart right after the kill does not send us searching at once.
                const prev = boss && boss.name === name ? boss : null;
                if (!prev) searchLater(name);
                const info = seen ? bossInfo(name, seen) : told.info;
                boss = seen
                    ? { name: name, seenAt: Date.now(), id: seen.id }
                    : { name: name, seenAt: told.at, id: told.id, dest: walkTo(told) };
                boss.first = prev && prev.first ? prev.first : { at: Date.now(), info: info };
                boss.info = info || (prev && prev.info) || null;
                if (!prev && seen) util.log("event", name + " in my sight " + infoText(info), "green");
                break;
            }
        }
        if (boss && Date.now() - boss.seenAt < 30 * 1000 && !killedAt(boss.id)) return { name: boss.name, monster: boss.name, dest: boss.dest || boss.name, sighted: true };
        if (boss) {
            const killed = killedAt(boss.id);
            outcome(boss, killed ? "killed" : "gone without a kill seen");
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

        if (!leads && job && job.kill && soloKill()) return "ok"; // runner: fighting its solo boss (current)
        // Another team boss in sight on the way (2026-11-21: the runner saw the Phoenix in main on its way
        // to Dracul, reported it and walked on - the team came, the Phoenix was gone): stop the job and
        // stay at it - the leader engages it from our report; the job's boss is searched again after it.
        if (!leads && job && !job.kill) {
            const other = watched().find(function (n) { return n !== job.name && !(rcfg.solo || []).includes(n) && get_nearest_monster({ type: n }); });
            if (other) {
                util.log("event", other + " in sight - stopping the " + job.name + " search", "green");
                const j = job;
                j.stop = true;
                job = null;
                ctx.comms.send(config.leader, "searchdone", { id: j.id, found: false, interrupted: other });
                try { stop(); } catch (e) { /* not walking */ }
            }
        }
        if (!leads && job) return "busy"; // walking our share of a parallel boss search
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
        checkRunner();
        // One search at a time: the team search waits while a runner is out, and the other way round.
        if (!current && !runnerJob) {
            // A nonstop boss with a runner is the runner's job, not the team's.
            const due = (cfg.search || []).find(function (name) {
                return policy(name) === "always" && Date.now() >= (nextSearchAt[name] || 0) && !nonstopRunner(name);
            });
            if (due) {
                searchBoss(due);
                return "busy";
            }
            // Runner bosses: only from the farm spot (not on a route), so the runner starts from the team.
            // The other runner bosses come first when due, the nonstop one fills every gap.
            if (!(typeof smart !== "undefined" && smart.moving)) {
                const nonstop = (cfg.farmBosses || []).filter(function (n) { return !!nonstopRunner(n); });
                const run = runnerBosses().filter(function (n) { return !nonstop.includes(n); }).concat(nonstop).find(function (name) {
                    return policy(name) === "always" && Date.now() >= (nextSearchAt[name] || 0);
                });
                if (run) startRunner(run);
            }
        }
        return "ok";
    }

    return {
        tick: tick,
        current: function () { return current; },
        // Leader: a parallel (split) boss search is under way - the members walk their own areas, no team wait.
        splitSearching: function () { return !!(split && searching); },
        // Leader: not waited for - the runner on a job, and the nonstop runner between its laps too.
        runnerOut: function () {
            if (runnerJob) return runnerJob.who;
            if (!leads) return null;
            if (lastRunner && Date.now() - lastRunner.at < 2 * 60 * 1000) return lastRunner.who; // on its way back
            return nonstopActive();
        },
        onOwnDeath: onOwnDeath, // fighter.handleDeath
        // Chat command /phoenix (main.js, player request 2026-11-21): search a boss now, lifting a pause.
        searchNow: function (name) {
            if (!leads) return "only the leader (" + config.leader + ") searches";
            if (!watched().includes(name)) return name + " is not a boss we search (" + watched().join(", ") + ")";
            nextSearchAt[name] = Date.now();
            delete paused[name];
            try { set(SEARCH_KEY, nextSearchAt); set(PAUSE_KEY, paused); } catch (e) { /* storage unavailable */ }
            Object.keys(verdicts).forEach(function (k) { if (k.indexOf(name) === 0 || k.indexOf("solo:" + name) === 0) delete verdicts[k]; });
            util.log("event", name + ": search now (chat command)", "yellow");
            return name + " - searching now" + (searching || runnerJob ? " (after the search under way)" : "");
        },
        soloOk: soloOk,         // targeting.holdBoss: too strong for me alone -> hold for the team
        bossBusy: bossBusy,     // fighter.busyStep: no Daisy trips during a boss fight
        // A roaming boss is in sight (ours or a member's): the leader goes to it, no team wait.
        // Checked live: the team wait runs before tick(), so `current` stays stale while waiting
        // (2026-11-20: the priest waited 45 s for the warrior with the Phoenix reported).
        engaging: function () { return !!(current && current.sighted) || (leads && !!visibleBoss()); },
        teamStats: teamStats, // leader: own stats + fresh member reports
    };
};
