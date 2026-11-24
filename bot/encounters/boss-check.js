// =====================================================================
// encounters/boss-check.js - can the team (or one runner) beat a boss: burst, healing, time from everyone's stats; the policy per boss.
// Part of bot_events (module plan, stage 4c): moved verbatim from the old single-file core/events.js. The parts
// share one internal state (evs: the current event, searches, runners, sightings) and call each other through evs;
// outside dependencies come in deps (game, util, config, comms, party, cave, bus, teamStats).
// =====================================================================

module.exports = function install(evs, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const cfg = config.events;
    const bcfg = cfg.boss || {};
    const teamStats = deps.teamStats.teamStats;
    const stats = deps.teamStats.reports;

    function teamLevel() {
        return util.teamLevel(config);
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
        // 1. Burst: every fighter survives minHits hits. With a tank in the team (Taunt keeps the boss on it) the
        // others need only minHitsNonTank (2026-11-22, player decision: Ms. Dracul hits the ranger for ~800 - 4.4
        // hits - while the warrior tanks her for 15; kiting in tight spots like Dracul's cave doesn't work).
        const tankClasses = (config.targeting.teamSafety && config.targeting.teamSafety.tankClasses) || ["warrior", "paladin"];
        const hasTank = !alone && team.some(function (f) { return tankClasses.includes(f.ctype); });
        for (const f of team) {
            const byBoss = (bcfg.minHitsNonTankBy || {})[name];
            const need = hasTank && !tankClasses.includes(f.ctype) ? (byBoss || bcfg.minHitsNonTank || minHits) : minHits;
            const hits = f.max_hp / hitOn(f);
            if (hits < need) return { ok: false, why: f.name + " survives only " + hits.toFixed(1) + " hits (need " + need + ")" };
        }
        // 2. Healing vs. damage on the tank: a warrior/paladin in the party (Taunt keeps the
        // boss on it), else the leader.
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
        if (evs.paused[name] > Date.now()) return false;
        const seen = get_nearest_monster({ type: name });
        const lvl = seen ? (seen.level || 1) : 1;
        const key = name + ":" + lvl;
        const v = evs.verdicts[key];
        if (v && Date.now() - v.at < 60 * 1000) return v.ok;
        const r = assessBoss(name, null, seen);
        const tag = lvl > 1 ? " (level " + lvl + ")" : "";
        if (!v || v.ok !== r.ok) util.log("event", name + tag + (r.ok ? " looks doable: " : " not doable yet: ") + r.why, r.ok ? "green" : "white");
        evs.verdicts[key] = { ok: r.ok, why: r.why, at: Date.now() };
        return r.ok;
    }
    function soloOk(t) {
        if (!t || !G.monsters[t.mtype]) return true;
        const key = t.mtype + ":" + (t.level || 1);
        const c = evs.soloSeen[key];
        if (c && Date.now() - c.at < 30 * 1000) return c.ok;
        const r = assessBoss(t.mtype, util.combatStats(), t);
        if (!c || c.ok !== r.ok) util.log("event", t.mtype + " level " + (t.level || 1) + (r.ok ? " - I can take it alone: " : " - too strong for me alone, holding for the team: ") + r.why, r.ok ? "green" : "white");
        evs.soloSeen[key] = { ok: r.ok, at: Date.now() };
        return r.ok;
    }

    // Can `who` (a runner) beat the boss alone? From its last reported stats; cached for a minute,
    // logged when the verdict changes. A pause after a death counts here too.
    function canSolo(name, who) {
        if (evs.paused[name] > Date.now()) return false;
        const key = "solo:" + name + ":" + who;
        const v = evs.verdicts[key];
        if (v && Date.now() - v.at < 60 * 1000) return v.ok;
        const s = stats[who] && Date.now() - stats[who].at < 30 * 60 * 1000 ? stats[who].s : null;
        const r = s ? assessBoss(name, s) : { ok: false, why: "no stats from " + who + " yet" };
        if (!v || v.ok !== r.ok) util.log("event", name + (r.ok ? " looks doable for " + who + " alone: " : " not doable for " + who + " alone: ") + r.why, r.ok ? "green" : "white");
        evs.verdicts[key] = { ok: r.ok, why: r.why, at: Date.now() };
        return r.ok;
    }
    // "always" only counts once every fighter reaches the event's minimum level and,
    // for a boss monster, once the boss check says the team can beat it.
    function policy(name) {
        const p = (cfg.policy && cfg.policy[name]) || "never";
        const min = (cfg.minLevel && cfg.minLevel[name]) || 0;
        if (p === "always" && teamLevel() < min) {
            if (!evs.skippedForLevel[name]) {
                evs.skippedForLevel[name] = true;
                util.log("event", name + " needs level " + min + " for everyone - skipping for now", "white");
            }
            return "never";
        }
        evs.skippedForLevel[name] = false;
        if (p === "always" && G.monsters[name] && !(G.events[name] && G.events[name].join) && !canBeat(name)) return "never";
        // Join events with a monster the team must handle (events.joinNeeds, 2026-11-23): the Giga Crab only while the
        // boss check says the team survives its Huge Crabs - we never take the Giga Crab's hits (events.foreignOnly).
        const need = (cfg.joinNeeds || {})[name];
        if (p === "always" && need && G.monsters[need] && !canBeat(need)) return "never";
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
        if (key === evs.lastLiveKey) return;
        evs.lastLiveKey = key;
        if (list.length) {
            util.log("event", "live now: " + list.map(function (e) {
                return e.name + (e.map ? " @" + e.map : "") + " [" + policy(e.name) + "]";
            }).join(", "), "yellow");
        }
    }

    Object.assign(evs, {
        teamLevel: teamLevel,
        assessBoss: assessBoss,
        canBeat: canBeat,
        soloOk: soloOk,
        canSolo: canSolo,
        policy: policy,
        liveEntries: liveEntries,
        observe: observe,
    });
};
