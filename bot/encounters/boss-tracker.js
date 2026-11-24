// =====================================================================
// encounters/boss-tracker.js - bosses in sight and their deaths: ours and the members' sightings, the deaths the listener
// in core/events.js records, what became of a boss.
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
    const scfg = cfg.scout || {};
    const PAGE = parent;
    const bcfg = cfg.boss || {};
    const PAUSE_KEY = "bot_boss_pause:" + character.name;

    function killedAt(id) {
        if (!id) return 0;
        const e = parent.entities && parent.entities[id];
        if (e && e.dead) return Date.now();
        return (PAGE.__botDeaths && PAGE.__botDeaths[id]) || 0;
    }

    // A boss fight is on or about to start: one in our sight (any watched boss, paused or not), the
    // team's current boss event, or (leader) a fresh member sighting. No Daisy trips then
    // (player request 2026-11-21: the team walked to Daisy in the middle of a half-dead Phoenix).
    function bossBusy() {
        if (evs.current && !evs.current.join) return true;
        return evs.watched().some(function (n) {
            const m = get_nearest_monster({ type: n });
            return (m && !m.dead) || (leads && !!memberSighting(n));
        });
    }
    function watchBossDeaths() {
        if (!leads || !evs.current || evs.current.join || !evs.current.monster || !G.monsters[evs.current.monster]) return;
        const dead = [character.name].concat(party.memberNames()).find(function (n) {
            const p = n === character.name ? character : get_player(n);
            return p && p.rip;
        });
        if (!dead || evs.paused[evs.current.monster] > Date.now()) return;
        // Only a death AT the boss (player decision 2026-11-21): the warrior died to two Fire Roamers on
        // the way to a Phoenix the ranger had seen in the cave, and the Phoenix was paused for 3 h. The
        // boss must be in our sight within bossDeathRange of the dead one (fighting it, not walking to it).
        const deadP = dead === character.name ? character : get_player(dead);
        const bossNear = Object.values(parent.entities || {}).some(function (e) {
            return e && e.type === "monster" && e.mtype === evs.current.monster && deadP &&
                Math.hypot((e.real_x || e.x) - (deadP.real_x || deadP.x), (e.real_y || e.y) - (deadP.real_y || deadP.y)) <= (bcfg.bossDeathRange || 600);
        });
        if (!bossNear) {
            if (evs.lastDeathNoPause !== dead + "|" + evs.current.monster) {
                evs.lastDeathNoPause = dead + "|" + evs.current.monster;
                util.log("event", dead + " died away from " + evs.current.monster + " - not pausing it", "orange");
            }
            return;
        }
        evs.lastDeathNoPause = "";
        evs.paused[evs.current.monster] = Date.now() + (bcfg.pauseAfterDeathMs || 3 * 60 * 60 * 1000);
        try { set(PAUSE_KEY, evs.paused); } catch (e) { /* storage unavailable */ }
        util.log("event", dead + " died fighting " + evs.current.monster + " - pausing it for " +
            Math.round((bcfg.pauseAfterDeathMs || 3 * 60 * 60 * 1000) / 3600000) + " h", "red");
        evs.boss = null;
    }

    // Any target boss in sight ends a search at once (player decision 2026-11-20): the search
    // only looked for its own boss - a Phoenix met on the way to Dracul's spot, or Dracul next
    // to the Phoenix in the cave, was walked past. Returns the visible boss's name or null.
    function visibleBoss() {
        return evs.watched().find(function (n) {
            return (get_nearest_monster({ type: n }) || memberSighting(n)) && evs.policy(n) === "always";
        }) || null;
    }
    // Where and how we meet a boss (player request 2026-11-21: the Phoenix was often gone without our
    // kill - probably at spawn areas where other players farm). Into the journal with every sighting
    // and outcome: spawn area, HP, who fights it, other players near it.
    function ours() { return Object.keys(config.characters || {}); }
    function bossInfo(name, m) {
        const p = { x: Math.round(m.x), y: Math.round(m.y) };
        let area = null, best = Infinity;
        evs.spawnSpots(name).forEach(function (s) {
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
    function reportBossDeaths() {
        const now = Date.now();
        Object.keys(evs.reportedBoss).forEach(function (id) {
            const killed = killedAt(id);
            if (killed) {
                deps.comms.send(config.leader, "bossdeath", { id: id, name: evs.reportedBoss[id].name, at: killed });
                delete evs.reportedBoss[id];
            } else if (now - evs.reportedBoss[id].at > 10 * 60 * 1000) delete evs.reportedBoss[id];
        });
    }
    function reportSightings() {
        if (leads) return;
        reportBossDeaths();
        if (Date.now() - evs.lastSightingSent < 2000) return;
        evs.watched().some(function (name) {
            // A runner kills its own solo boss alone - no call for the team (runner, 2026-11-21).
            if (evs.job && evs.job.solo && evs.job.name === name) return false;
            if (evs.nonstopUntil[name] > Date.now()) return false; // nonstop runner between two laps: no call either
            const m = get_nearest_monster({ type: name });
            if (!m) return false;
            evs.lastSightingSent = Date.now();
            evs.reportedBoss[m.id] = { name: name, at: Date.now() };
            // fx/fy: where we stand - walkable, unlike a Phoenix flying over a cliff (2026-11-21).
            deps.comms.send(config.leader, "bosssight", { name: name, id: m.id, map: character.map, x: Math.round(m.x), y: Math.round(m.y), fx: Math.round(character.x), fy: Math.round(character.y), info: bossInfo(name, m) });
            return true;
        });
    }
    // A member's fresh sighting (10 s) of a boss that is not known dead, or null. The merchant's (scout) report holds
    // until scout.holdMs, or until one of us has stood within scout.arriveRadius px of the reported boss for
    // scout.arriveGraceMs without a fresh sighting (then it is gone - our own sightings replace the report).
    function fighterAt(s) {
        const near = scfg.arriveRadius || 300;
        if (character.map === s.map && Math.hypot(character.real_x - s.x, character.real_y - s.y) <= near) return true;
        const info = get_party() || {};
        return party.memberNames().some(function (n) {
            const p = info[n];
            return !!p && p.map === s.map && typeof p.x === "number" && Math.hypot(p.x - s.x, p.y - s.y) <= near;
        });
    }
    function memberSighting(name) {
        const s = evs.sightings[name];
        if (!s || killedAt(s.id)) return null;
        if (s.scout) {
            if (Date.now() > s.until) return null;
            if (!s.arrivedAt && fighterAt(s)) s.arrivedAt = Date.now();
            if (s.arrivedAt && Date.now() - s.arrivedAt > (scfg.arriveGraceMs || 10 * 1000)) return null;
            return s;
        }
        if (Date.now() - s.at > 10 * 1000) return null;
        return s;
    }

    Object.assign(evs, {
        killedAt: killedAt,
        watchBossDeaths: watchBossDeaths,
        visibleBoss: visibleBoss,
        ours: ours,
        bossInfo: bossInfo,
        infoText: infoText,
        outcome: outcome,
        reportBossDeaths: reportBossDeaths,
        reportSightings: reportSightings,
        fighterAt: fighterAt,
        memberSighting: memberSighting,
        bossBusy: bossBusy,
    });
};
