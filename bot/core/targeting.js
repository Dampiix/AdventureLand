// =====================================================================
// bot_targeting – WHAT to farm and WHICH monster to hit next.
//
// Farm choice, in order:
//   1. a live event / world boss (bot_events)
//   2. an open, safe Monster Hunt of any party fighter (bot_hunts)
//   3. per-character or global farm setting (config.characters[name].farm,
//      config.targeting.farm)
//   4. a drop route for an item the merchant is missing (bot_drops)
//   5. the game's progression guide: get_progression().choices
//      (top safe farm routes for this character's current gear)
//   6. config.targeting.fallback
// Party members use the leader's farm target instead.
//
// Target choice:
//   leader / solo: current target > monster attacking a party member
//                  > nearest free farm monster
//   party member:  current target > monster attacking a party member
//                  > own monster when the farm target is easy (party.spread)
//                  > the leader's target – otherwise members never open fights,
//                  so the tank keeps the aggro
// =====================================================================

module.exports = function createTargeting(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const party = ctx.party;
    const cfg = config.targeting;
    let farm = null;
    let nextPickAt = 0;
    const crowdedUntil = {}; // monster -> timestamp: skip this guide choice until then
    let idleSince = 0;       // on the farm map without a free target since

    // ---- team safety ------------------------------------------------------------
    // The guide judges a route only for the character asking (the leader, usually
    // the tank). It also offers borderline routes as a careful "trial" and only
    // counts them as proven from fights it watched since CODE started – a restart
    // forgets that. So:
    //  - every member reports its "safe" monsters (trials included) and its "sure"
    //    ones (safe and not a mere trial),
    //  - the leader remembers the team's own experience (survives restarts): a
    //    monster farmed for 15+ minutes without anyone dying counts as proven,
    //    a death there wipes that,
    //  - a spot needs everyone's "safe", and everyone's "sure" or our own proof
    //    (config.targeting.avoidTrial).
    const comms = ctx.comms;
    const reports = {};   // member -> { safe, sure, at }
    let lastReport = 0;
    let lastSkipLog = "";

    const PROVEN_MS = 15 * 60 * 1000;
    const EXP_KEY = "dmpx_farm_experience:" + character.name;
    const experience = (function () { // monster -> { ms, at, bad }
        try { return get(EXP_KEY) || {}; } catch (e) { return {}; }
    })();
    let lastClock = 0;
    let lastSave = 0;

    function saveExperience() {
        try { set(EXP_KEY, experience); } catch (e) { /* storage unavailable */ }
    }
    function provenByUs(monster) {
        const e = experience[monster];
        return !!e && e.ms >= PROVEN_MS && Date.now() - e.at < 24 * 60 * 60 * 1000;
    }
    function recentDeath(monster) {
        const e = experience[monster];
        return !!e && !!e.bad && Date.now() - e.bad < 60 * 60 * 1000;
    }

    // Leader: count the time spent on the current farm target; a death wipes it.
    function clock() {
        const now = Date.now();
        const dt = lastClock ? Math.min(5000, now - lastClock) : 0;
        lastClock = now;
        if (party.isMember || !farm || !farm.monster || farm.any) return;
        const e = experience[farm.monster] || (experience[farm.monster] = { ms: 0, at: now });
        // Only a death at the farm spot counts: on the farm map with such a monster nearby
        // (a death on the way or at a hunt somewhere else must not mark this monster).
        const dead = [character.name].concat(party.memberNames()).find(function (n) {
            const p = n === character.name ? character : get_player(n);
            if (!p || !p.rip) return false;
            if (farm.map && p.map !== farm.map) return false;
            const m = get_nearest_monster({ type: farm.monster });
            return !!m && Math.hypot(m.x - p.x, m.y - p.y) < 500;
        });
        if (dead) {
            if (!(e.bad && now - e.bad < 60 * 1000)) {
                util.log("target", dead + " died while farming " + farm.monster + " - not counted as safe for an hour", "red");
                experience[farm.monster] = { ms: 0, at: now, bad: now };
                saveExperience();
                nextPickAt = 0;
            }
            return;
        }
        if (farm.map && character.map !== farm.map) return; // still travelling
        const before = e.ms;
        e.ms += dt;
        e.at = now;
        if (before < PROVEN_MS && e.ms >= PROVEN_MS) util.log("target", farm.monster + ": 15 min without deaths - counts as safe for the team", "green");
        if (now - lastSave > 60 * 1000) { lastSave = now; saveExperience(); }
    }

    if (comms) {
        comms.on("safe", function (data, from) {
            if (!config.characters[from]) return;
            reports[from] = { listed: data.listed || null, safe: data.safe || data.list || [], sure: data.sure || data.list || [], at: Date.now() };
            // Our current guide spot is not acceptable for this member: pick again right away.
            if (farm && String(farm.source).startsWith("guide") && lastingObjector(farm.monster, null)) nextPickAt = 0;
        });
    }

    // Monsters our own guide calls safe (trials included) and sure (no mere trial),
    // or null when the guide has no route data.
    function ownSafe(advice) {
        const routes = advice && advice.routes;
        if (!Array.isArray(routes)) return null;
        const safe = routes.filter(function (r) { return r && r.safe; });
        return {
            listed: new Set(routes.filter(Boolean).map(function (r) { return r.monster; })),
            safe: new Set(safe.map(function (r) { return r.monster; })),
            sure: new Set(safe.filter(function (r) { return !r.trial || r.proven; }).map(function (r) { return r.monster; })),
        };
    }

    // Monsters the guide doesn't list at all (e.g. goos once we outgrew them) are not
    // "unsafe", just unknown: harmless if every fighter survives 20+ of their hits
    // (team stats from bot_events, the game's damage formula).
    function harmless(monster) {
        const m = G.monsters[monster];
        if (!m || m.cooperative || (m.abilities && Object.keys(m.abilities).length)) return false;
        const team = ctx.events && ctx.events.teamStats ? ctx.events.teamStats() : [util.combatStats()];
        return team.every(function (f) {
            const def = m.damage_type === "physical" ? (f.armor || 0) - (m.apiercing || 0) : (f.resistance || 0) - (m.rpiercing || 0);
            return f.max_hp >= 20 * (m.attack || 0) * 1.1 * util.damageMultiplier(def);
        });
    }

    function shareSafe() {
        if (!party.isMember || !comms || Date.now() - lastReport < 60 * 1000) return;
        lastReport = Date.now();
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        if (own) comms.send(config.leader, "safe", { listed: Array.from(own.listed), safe: Array.from(own.safe), sure: Array.from(own.sure) });
    }

    // ---- team model (config.targeting.teamSafety) -----------------------------------
    // The per-member rule above asks every fighter's guide whether it could farm the
    // monster ALONE – so a tank changes nothing. The team model judges the party like
    // the boss check does, from everyone's stats (members report them every minute)
    // and the game's damage formula:
    //   tank:    survives tankHits volleys of `pull` monsters (pullAggressive for monsters
    //            that attack on sight) and the priests' healing covers that damage per
    //            second (x healCover; potions do the rest)
    //   others:  survive otherHits hits of one monster – the tank's Taunt pulls it off
    // Monsters with special abilities are left to the guide (teamSafety.abilities lists
    // the ones we accept).
    const ts = cfg.teamSafety || {};
    function teamModelOn() {
        return !!ts.enabled && party.enabled && !party.isMember;
    }
    function teamVerdict(monster) {
        const m = G.monsters[monster];
        if (!m || m.cooperative) return { ok: false, why: "no data / cooperative" };
        const odd = Object.keys(m.abilities || {}).filter(function (a) { return !(ts.abilities || []).includes(a); });
        if (odd.length) return { ok: false, why: "abilities: " + odd.join(", ") };
        const team = ctx.events && ctx.events.teamStats ? ctx.events.teamStats() : [util.combatStats()];
        const expected = config.team.fighters.filter(function (f) { return f === character.name || party.inParty(f); }).length;
        if (team.length < expected) return { ok: false, why: "waiting for the team's stats" };
        const tank = team.filter(function (f) { return (ts.tankClasses || []).includes(f.ctype); })
            .sort(function (a, b) { return b.max_hp - a.max_hp; })[0];
        if (!tank) return { ok: false, why: "no tank in the party" };
        const hitOn = function (f) {
            let def = 0;
            if (m.damage_type === "physical") def = (f.armor || 0) - (m.apiercing || 0);
            else if (m.damage_type === "magical") def = (f.resistance || 0) - (m.rpiercing || 0);
            return (m.attack || 0) * 1.1 * util.damageMultiplier(def);
        };
        const pull = (m.aggro || 0) >= 1 ? (ts.pullAggressive || 3) : (ts.pull || 2);
        const volley = hitOn(tank) * pull;
        const tankHits = tank.max_hp / Math.max(1, volley);
        if (tankHits < (ts.tankHits || 6)) return { ok: false, why: tank.name + " survives " + tankHits.toFixed(1) + " volleys of " + pull + " (need " + (ts.tankHits || 6) + ")" };
        const incoming = volley * (m.frequency || 1);
        const healing = team.reduce(function (s, f) { return s + (f.ctype === "priest" ? (f.heal || f.attack || 0) * (f.frequency || 1) : 0); }, 0);
        if (incoming > healing * (ts.healCover || 1.5)) return { ok: false, why: Math.round(incoming) + " dmg/s on " + tank.name + " vs " + Math.round(healing) + " healing/s" };
        for (const f of team) {
            if (f === tank) continue;
            const hits = f.max_hp / Math.max(1, hitOn(f));
            if (hits < (ts.otherHits || 3)) return { ok: false, why: f.name + " survives " + hits.toFixed(1) + " hits (need " + (ts.otherHits || 3) + ")" };
        }
        return { ok: true, why: tank.name + " tanks " + pull + " (" + tankHits.toFixed(1) + " volleys, " + Math.round(incoming) + " dmg/s vs " + Math.round(healing) + " healing/s)" };
    }

    // Leader command "/safety [map]": every monster of the map (default: ours) with each
    // member's own guide verdict and the team model's verdict – to see why a spot is closed.
    function safetyReport(mapName) {
        const mapId = (mapName || "").trim() || character.map;
        const map = G.maps[mapId];
        if (!map) { util.log("safety", "unknown map " + mapId, "orange"); return; }
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        const types = Array.from(new Set((map.monsters || []).map(function (p) { return p.type; }))).filter(function (t) { return G.monsters[t]; });
        util.log("safety", mapId + ": " + types.length + " monster types" + (ts.enabled ? "" : " (team model is off)"), "yellow");
        types.forEach(function (t) {
            const members = [];
            if (own) members.push(character.name + ":" + (own.safe.has(t) ? (own.sure.has(t) ? "safe" : "trial") : own.listed.has(t) ? "UNSAFE" : "?"));
            Object.keys(reports).forEach(function (n) {
                const r = reports[n];
                if (!party.inParty(n)) return;
                members.push(n + ":" + (r.safe.includes(t) ? (r.sure.includes(t) ? "safe" : "trial") : r.listed && r.listed.includes(t) ? "UNSAFE" : "?"));
            });
            const v = teamVerdict(t);
            util.log("safety", t + " | " + members.join(" ") + " | team: " + (v.ok ? "OK - " : "no - ") + v.why, v.ok ? "green" : "white");
        });
    }

    // Who (if anyone) is not safe at this monster.
    function objector(monster, own) {
        if (recentDeath(monster)) return "the team (recent death)";
        // Team model: the party as a whole can take it – no single member's veto.
        if (teamModelOn() && teamVerdict(monster).ok) return null;
        const proven = !cfg.avoidTrial || provenByUs(monster);
        let unlisted = 0; // fighters whose guide doesn't know the monster
        if (own) {
            if (!own.listed.has(monster)) unlisted++;
            else if (!own.safe.has(monster) || (!proven && !own.sure.has(monster))) return character.name;
        }
        const now = Date.now();
        const member = Object.keys(reports).find(function (name) {
            const r = reports[name];
            if (!party.inParty(name) || now - r.at > 3 * 60 * 1000) return false;
            if (r.listed && !r.listed.includes(monster)) { unlisted++; return false; }
            return !r.safe.includes(monster) || (!proven && !r.sure.includes(monster));
        });
        if (member) return member;
        if (unlisted && !harmless(monster)) return "the team (" + monster + " unknown to the guide, not harmless)";
        return null;
    }

    // Like objector(), but the spot we farm right now is only given up when an
    // objection lasts objectionGraceMs: a guide verdict near the edge flips with HP,
    // buffs and gear, and each flip used to send the team across the map. A death
    // there still counts at once.
    const objectedSince = {}; // monster -> first objection in the current streak
    function lastingObjector(monster, own) {
        const who = objector(monster, own);
        if (!who) { delete objectedSince[monster]; return null; }
        const here = farm && farm.monster === monster && String(farm.source).startsWith("guide");
        if (!here || recentDeath(monster)) return who;
        const now = Date.now();
        if (!objectedSince[monster]) {
            objectedSince[monster] = now;
            util.log("target", monster + " looks unsafe for " + who + " - staying unless that lasts " +
                Math.round((cfg.objectionGraceMs || 0) / 60000) + " min", "white");
        }
        return now - objectedSince[monster] >= (cfg.objectionGraceMs || 0) ? who : null;
    }

    // For bot_hunts: is this monster safe for the whole team right now?
    function isTeamSafe(monster) {
        return !whyUnsafe(monster);
    }
    // null when safe, else who/what objects (for logs).
    function whyUnsafe(monster) {
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        if (!own) return "no guide data yet";
        const who = objector(monster, own);
        return who ? "not safe for " + who : null;
    }

    // The guide's farm choices (up to three safe routes, best first) that are safe
    // for the whole team, skipping monsters whose spot was recently found crowded.
    function fromProgression() {
        let list = [];
        let spare = []; // other safe routes, for when every choice is crowded
        try {
            const advice = get_progression();
            if (!advice) return null;
            const own = ownSafe(advice);
            // Team model: the guide's routes (for the leader alone) ranked by XP, keeping
            // every monster the team can take – also ones the guide calls unsafe solo.
            if (teamModelOn() && Array.isArray(advice.routes)) {
                const seen = {};
                const teamList = advice.routes
                    .filter(function (r) { return r && G.monsters[r.monster] && !lastingObjector(r.monster, own); })
                    .sort(function (a, b) { return (b.xp || 0) - (a.xp || 0); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .slice(0, 3)
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, team model" }; });
                if (teamList.length) {
                    const now = Date.now();
                    return teamList.find(function (c) { return !(crowdedUntil[c.monster] > now); }) || teamList[0];
                }
            }
            const raw = (advice.choices || [])
                .filter(function (c) { return c.kind === "farm" && G.monsters[c.monster]; });
            list = raw
                .filter(function (c) { return !lastingObjector(c.monster, own); })
                .map(function (c) { return { monster: c.monster, map: c.map, source: "guide" }; });
            if (raw.length && list.length < raw.length) {
                // The guide's best pick is too risky for someone: say so once.
                const first = raw[0];
                const who = objector(first.monster, own);
                const msg = who ? first.monster + " is not safe for " + who + (list.length ? " - " + list[0].monster + " instead" : "") : "";
                if (msg && msg !== lastSkipLog) { lastSkipLog = msg; util.log("target", msg, "orange"); }
            }
            if (!list.length && Array.isArray(advice.routes)) {
                // None of the top three is safe for everyone: best other safe route.
                const seen = {};
                list = advice.routes
                    .filter(function (r) { return r && r.safe && G.monsters[r.monster] && !objector(r.monster, own); })
                    .sort(function (a, b) { return (b.xp || 0) - (a.xp || 0); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .slice(0, 3)
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, team-safe" }; });
            }
            if (Array.isArray(advice.routes)) {
                const seen = {};
                spare = advice.routes
                    .filter(function (r) { return r && r.safe && G.monsters[r.monster] && !objector(r.monster, own); })
                    .sort(function (a, b) { return (b.xp || 0) - (a.xp || 0); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, next free spot" }; });
            }
            if (!list.length && !raw.length) {
                const row = (advice.rows || []).find(function (r) {
                    return r.action && r.action.kind === "farm" && r.action.route && G.monsters[r.action.route.monster];
                });
                if (row) list = [{ monster: row.action.route.monster, map: row.action.route.map, source: "guide task" }];
            }
        } catch (e) {
            util.log("target", "get_progression failed: " + util.errReason(e), "red");
        }
        if (!list.length) return null;
        const now = Date.now();
        const free = list.find(function (c) { return !(crowdedUntil[c.monster] > now); });
        if (free) return free;
        // Every choice is crowded: the best other safe route that isn't...
        const other = spare.find(function (c) { return !(crowdedUntil[c.monster] > now); });
        if (other) return other;
        // ...else the one that frees up first.
        return list.slice().sort(function (a, b) { return crowdedUntil[a.monster] - crowdedUntil[b.monster]; })[0];
    }

    // Called by the fighter every combat tick. If we stand on the farm map for
    // a while without any free target (other players clear the spot), mark the
    // spot as crowded and move on to the guide's next choice (or the next drop route).
    // Besides a long gap without any target, a spot where other players leave us only
    // the odd monster is crowded too: we measure the share of time without a target over
    // a sliding window (crowdedWindowMs) and give up above crowdedIdleShare.
    let win = null; // { monster, start, last, idle }
    // A spot found crowded again soon after the last time is skipped longer each time
    // (crowdedForMs, doubled per repeat up to crowdedMaxMs). Kept across restarts.
    const CROWD_KEY = "dmpx_crowded:" + character.name;
    const crowdHistory = (function () { try { return get(CROWD_KEY) || {}; } catch (e) { return {}; } })(); // monster -> { n, at, until }
    Object.keys(crowdHistory).forEach(function (m) { if (crowdHistory[m].until > Date.now()) crowdedUntil[m] = crowdHistory[m].until; });
    function markCrowded(why) {
        const now = Date.now();
        const h = crowdHistory[farm.monster];
        // A repeat within a day of the last time counts up; otherwise start over.
        const n = h && now - h.at < 24 * 60 * 60 * 1000 ? h.n + 1 : 1;
        const ms = Math.min(cfg.crowdedMaxMs || cfg.crowdedForMs, cfg.crowdedForMs * Math.pow(2, n - 1));
        crowdedUntil[farm.monster] = now + ms;
        crowdHistory[farm.monster] = { n: n, at: now, until: now + ms };
        try { set(CROWD_KEY, crowdHistory); } catch (e) { /* storage unavailable */ }
        util.log("target", farm.monster + " spot looks crowded (" + why + ") - trying another target for " + Math.round(ms / 60000) + " min", "orange");
        idleSince = 0;
        win = null;
        nextPickAt = 0; // pick again right away
    }
    function reportSearch(found) {
        const src = farm ? String(farm.source) : "";
        const now = Date.now();
        if (!farm || !(src.startsWith("guide") || src.startsWith("drop")) || character.map !== farm.map) {
            idleSince = 0;
            win = null;
            return;
        }
        // Idle share over the window.
        if (!win || win.monster !== farm.monster) win = { monster: farm.monster, start: now, last: now, idle: 0 };
        const dt = Math.min(5000, now - win.last);
        win.last = now;
        if (!found) win.idle += dt;
        if (cfg.crowdedWindowMs && now - win.start >= cfg.crowdedWindowMs) {
            const share = win.idle / (now - win.start);
            if (share >= (cfg.crowdedIdleShare || 0.6)) { markCrowded(Math.round(share * 100) + "% of " + Math.round(cfg.crowdedWindowMs / 60000) + " min without a target"); return; }
            win = { monster: farm.monster, start: now, last: now, idle: 0 };
        }
        if (found) { idleSince = 0; return; }
        if (!idleSince) idleSince = now;
        if (now - idleSince >= cfg.crowdedAfterMs) markCrowded("no free target for " + Math.round(cfg.crowdedAfterMs / 1000) + " s");
    }

    // Monster types an event spawns in waves (G.events[name].waves), or null for "anything".
    function eventMonsters(name) {
        const waves = G.events[name] && G.events[name].waves;
        if (!Array.isArray(waves)) return null;
        const types = {};
        waves.forEach(function (w) { Object.keys((w && w[1]) || {}).forEach(function (t) { types[t] = true; }); });
        return Object.keys(types);
    }

    function currentFarm() {
        shareSafe(); // members: tell the leader where we can fight safely
        clock();     // leader: our own experience with the current farm target
        // Events and world bosses come first (bot_events; members get it from the leader).
        const ev = ctx.events ? ctx.events.current() : null;
        if (ev) {
            const next = ev.join
                ? { monster: null, any: true, types: eventMonsters(ev.name), source: "event " + ev.name }
                : { monster: ev.monster || ev.name, dest: ev.dest || ev.monster || ev.name, source: "event " + ev.name };
            if (!farm || farm.source !== next.source) util.log("target", "now: " + next.source, "yellow");
            farm = next;
            nextPickAt = 0;
            return farm;
        }

        const lead = party.leaderInfo();
        if (lead && lead.farm) {
            if (!farm || farm.monster !== lead.farm) util.log("target", "farm target: " + lead.farm + " (leader)", "yellow");
            farm = { monster: lead.farm, source: "leader" };
            nextPickAt = 0;
            return farm;
        }

        const own = config.characters[character.name] || {};
        const override = own.farm || config.targeting.farm;

        // An open, safe Monster Hunt beats both the guide and a configured farm target;
        // the configured target only replaces the guide's choice.
        const hunt = ctx.hunts ? ctx.hunts.target() : null;
        if (hunt) {
            if (!farm || farm.monster !== hunt.monster) util.log("target", "farm target: " + hunt.monster + " (" + hunt.source + ")", "yellow");
            farm = hunt;
            nextPickAt = 0; // re-evaluate the guide as soon as the hunt is over
            return farm;
        }

        const now = Date.now();

        // Items that can't be bought come before XP: the merchant reports what is
        // missing, the guide names the drop route (bot_drops).
        const drop = !override && ctx.drops ? ctx.drops.target(function (m) { return crowdedUntil[m] > now; }) : null;
        if (drop) {
            if (!farm || farm.monster !== drop.monster) util.log("target", "farm target: " + drop.monster + " (" + drop.source + ")", "yellow");
            farm = drop;
            nextPickAt = 0; // back to the guide as soon as the item is complete
            return farm;
        }

        if (farm && now < nextPickAt) return farm; // hunt/leader/drop targets reset nextPickAt to 0

        let next = override ? { monster: override, source: "config" } : fromProgression();
        if (!next) next = { monster: config.targeting.fallback, source: "fallback" };

        // The guide may not be ready right after login: retry soon instead of waiting minutes.
        nextPickAt = now + (next.source === "fallback" ? 30 * 1000 : config.targeting.refreshMs);

        if (!farm || farm.monster !== next.monster) {
            util.log("target", "farm target: " + next.monster + " (" + next.source + ")", "yellow");
        }
        farm = next;
        return farm;
    }

    function isOurs(name) {
        return name === character.name || party.inParty(name);
    }

    // A monster we can safely handle alone: dies in a few of our hits and barely
    // scratches us (config.party.spread).
    function isEasy(type) {
        const s = config.party.spread;
        const def = G.monsters[type];
        if (!s || !s.enabled || !def || def.cooperative) return false;
        return def.hp <= character.attack * s.maxHits && def.attack <= character.max_hp * s.maxDamageRatio;
    }

    // Cooperative monsters (event bosses, Phoenix, ...) reward every contributor,
    // so fighting them alongside other players is fine.
    function isCoop(t) {
        const def = G.monsters[t.mtype];
        return !!(def && def.cooperative);
    }

    // A target stays valid while it is visible, alive and not fighting someone else.
    function isValid(t) {
        if (!t || !t.visible || t.dead || t.type !== "monster") return false;
        if (t.target && !isOurs(t.target) && !isCoop(t)) return false;
        return true;
    }

    // Nearest monster attacking us or any party member (V1's party-aggro priority).
    function nearestPartyAttacker() {
        const names = party.memberNames();
        if (!names.includes(character.name)) names.push(character.name);
        let best = null;
        let bestDistance = Infinity;
        names.forEach(function (name) {
            const m = get_nearest_monster({ target: name });
            if (!m) return;
            const d = util.distanceTo(m);
            if (d < bestDistance) { best = m; bestDistance = d; }
        });
        return best;
    }

    function pick(farmTarget) {
        const current = get_targeted_monster();
        if (isValid(current)) return current;

        const attacker = nearestPartyAttacker();
        if (attacker) return attacker;

        // Join event (e.g. Goo Brawl): anything in the event map is fair game, and
        // everyone picks its own nearest monster – waiting for the leader's pick
        // (a melee paladin) left most kills to other players.
        if (farmTarget.any) {
            // Events with waves (e.g. Graveyard Rising in Spooky Town) share the map with other
            // monsters (mummies): only the event's own monsters count.
            if (farmTarget.types && farmTarget.types.length) {
                let best = null;
                farmTarget.types.forEach(function (type) {
                    const m = get_nearest_monster({ type: type });
                    if (isValid(m) && (!best || util.distanceTo(m) < util.distanceTo(best))) best = m;
                });
                return best;
            }
            const m = get_nearest_monster({});
            return isValid(m) ? m : null;
        }

        if (party.isMember) {
            const lead = party.leaderInfo();
            // Easy farm targets (e.g. goos for a hunt): everyone fights its own monster,
            // as long as it stays close to the leader.
            const own = lead && lead.farm && isEasy(lead.farm) ? get_nearest_monster({ type: lead.farm, no_target: true }) : null;
            if (own) {
                const p = util.xy(own);
                if (Math.hypot(p.x - lead.x, p.y - lead.y) <= config.party.leash * 0.8) return own;
            }
            // Otherwise only assist the leader, never pull new monsters –
            // and never wander off to a farm spot of our own.
            const assist = lead && lead.target ? get_monster(lead.target) : null;
            return isValid(assist) && (assist.target || isCoop(assist)) ? assist : null;
        }

        const type = farmTarget.monster;
        if (G.monsters[type] && G.monsters[type].cooperative) {
            const boss = get_nearest_monster({ type: type });
            if (isValid(boss)) return boss;
        }
        return get_nearest_monster({ type: type, no_target: true });
    }

    return { currentFarm: currentFarm, pick: pick, isValid: isValid, reportSearch: reportSearch, isTeamSafe: isTeamSafe, whyUnsafe: whyUnsafe,
        teamModelOn: teamModelOn, teamVerdict: teamVerdict, safetyReport: safetyReport };
};
